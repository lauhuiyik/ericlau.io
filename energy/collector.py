#!/usr/bin/env python3
"""Home energy collector.

Logs into the Anker SOLIX X1 (new array + battery + grid CT) and the Growatt
inverter (original array), normalizes a reading, and POSTs it to /api/ingest.

Credentials come from the site's .dev.vars locally, or environment variables in
CI (ANKER_EMAIL, ANKER_PASSWORD, GROWATT_USERNAME, GROWATT_PASSWORD, INGEST_SECRET,
INGEST_URL, ANKER_COUNTRY).

Usage:
  python collector.py --once            # one cycle, POST to INGEST_URL
  python collector.py --once --dry-run  # one cycle, print payload only
  python collector.py --interval 300    # loop forever every 300s
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession
import growattServer
from anker_solix_api.api import AnkerSolixApi
from anker_solix_api.hesapi import AnkerSolixHesApi

DEVVARS = os.environ.get(
    "DEVVARS_PATH",
    str(Path(__file__).resolve().parent.parent / ".dev.vars"),
)

log = logging.getLogger("collector")


def load_config() -> dict:
    """Merge .dev.vars (if present) with real environment variables (env wins)."""
    cfg: dict[str, str] = {}
    p = Path(DEVVARS)
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    for k in (
        "ANKER_EMAIL", "ANKER_PASSWORD", "GROWATT_USERNAME", "GROWATT_PASSWORD",
        "INGEST_SECRET", "INGEST_URL", "ANKER_COUNTRY", "GROWATT_PROXY_URL",
        "GROWATT_API_TOKEN", "GROWATT_PLANT_ID", "GROWATT_SKIP",
    ):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


def _f(v) -> float | None:
    """Coerce a value (possibly a string like '6.71') to float, else None."""
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


_UNIT = {"w": 0.001, "kw": 1.0, "mw": 1000.0, "wh": 0.001, "kwh": 1.0, "mwh": 1000.0}


def parse_qty(s) -> float | None:
    """Parse Growatt strings like '0 W', '3.6 kWh', '42.49 MWh' into kW / kWh."""
    if s is None:
        return None
    m = re.match(r"\s*(-?[\d.]+)\s*([a-zA-Z]+)?", str(s))
    if not m:
        return None
    val = float(m.group(1))
    unit = (m.group(2) or "").lower()
    return val * _UNIT.get(unit, 1.0)


def _kv_base_url(cfg: dict) -> str:
    """Site origin, derived from INGEST_URL (which points at /api/ingest)."""
    ingest_url = cfg.get("INGEST_URL", "http://localhost:3000/api/ingest")
    parts = urlsplit(ingest_url)
    return f"{parts.scheme}://{parts.netloc}"


def _kv_request(cfg: dict, path: str, method: str, body: dict | None = None) -> dict:
    url = _kv_base_url(cfg) + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg.get('INGEST_SECRET', '')}",
            "user-agent": "ericlau-energy-collector/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


# Process-level state so a multi-sample run touches KV exactly twice (once to
# restore the token, once to persist it) rather than per sample. Re-reading the
# on-disk cache each sample is cheap and does NOT re-login — the library only
# authenticates when the cached token is missing or expired.
_anker_cache_loaded = False
_anker_cache_path: Path | None = None

# Growatt's V1 API rate-limits per plant (error code 10012
# 'error_frequently_access') and its datalogger only publishes every ~5 min,
# so it's fetched once per run and reused across that run's samples. The
# reused value is genuinely current, not invented — the upstream number
# hasn't changed — and carrying it matters because house load is derived
# from total generation: dropping it on 3 of 4 samples would understate
# consumption on those rows.
_growatt_cache: dict | None = None


def load_anker_cache_blob(cfg: dict) -> str | None:
    try:
        return _kv_request(cfg, "/api/energy/anker-cache", "GET").get("blob")
    except Exception as e:  # noqa: BLE001
        log.warning("anker cache load failed: %s", e)
        return None


def save_anker_cache_blob(cfg: dict, blob: str) -> None:
    try:
        _kv_request(cfg, "/api/energy/anker-cache", "POST", {"blob": blob})
    except Exception as e:  # noqa: BLE001
        log.warning("anker cache save failed: %s", e)


# 36 Australis Dr, Williams Landing — used to decide whether a charging
# session is happening at home or out somewhere.
HOME_LAT, HOME_LNG, HOME_RADIUS_M = -37.860447, 144.742980, 150


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    import math
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def collect_tesla(cfg: dict) -> dict | None:
    """Live charge state from the Tesla Fleet API.

    Returns None (rather than raising) when Tesla simply isn't connected yet,
    so a missing authorisation doesn't look like a failure in the logs.

    Refresh tokens ROTATE — Tesla invalidates the old one on use — so the
    replacement is written straight back to KV. Skipping that would lock the
    next run out and force a manual re-authorise.
    """
    try:
        cred = _kv_request(cfg, "/api/energy/tesla-token", "GET")
    except Exception as e:  # noqa: BLE001
        log.warning("tesla token fetch failed: %s", e)
        return None
    if not cred.get("connected") or not cred.get("refresh_token"):
        return None
    client_id = cred.get("client_id")
    client_secret = cred.get("client_secret")
    base = cred.get("base_url") or "https://fleet-api.prd.na.vn.cloud.tesla.com"

    # refresh -> access token (+ rotated refresh token)
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": cred["refresh_token"],
    }).encode()
    req = urllib.request.Request(
        "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token",
        data=body, method="POST",
        headers={"content-type": "application/x-www-form-urlencoded",
                 "user-agent": "ericlau-energy-collector/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        tok = json.loads(resp.read().decode())
    access = tok.get("access_token")
    if not access:
        raise RuntimeError(f"tesla refresh returned no access_token: {tok}")
    if tok.get("refresh_token") and tok["refresh_token"] != cred["refresh_token"]:
        _kv_request(cfg, "/api/energy/tesla-token", "POST",
                    {"refresh_token": tok["refresh_token"], "base_url": base})

    def api(path: str) -> dict:
        r = urllib.request.Request(
            f"{base}{path}",
            headers={"authorization": f"Bearer {access}",
                     "user-agent": "ericlau-energy-collector/1.0"},
        )
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read().decode())

    vehicles = (api("/api/1/vehicles").get("response") or [])
    if not vehicles:
        raise RuntimeError("tesla: no vehicles on this account")
    tag = vehicles[0].get("vin") or vehicles[0].get("id_s")

    # A sleeping car returns 408; that's normal and not an error worth shouting
    # about — it just means no fresh sample this cycle.
    try:
        data = api(
            f"/api/1/vehicles/{tag}/vehicle_data"
            "?endpoints=charge_state%3Bdrive_state%3Blocation_data"
        )
    except urllib.error.HTTPError as e:
        if e.code in (408, 503):
            log.info("tesla asleep/unavailable (%s) — no sample this cycle", e.code)
            return None
        raise
    resp = data.get("response") or {}
    cs = resp.get("charge_state") or {}
    ds = resp.get("drive_state") or {}

    # Coordinates come back under location_data; drive_state carries speed and
    # heading but not position, so read location_data first and fall back.
    loc = resp.get("location_data") or {}
    lat = _f(loc.get("latitude")) if loc.get("latitude") is not None else _f(ds.get("latitude"))
    lng = _f(loc.get("longitude")) if loc.get("longitude") is not None else _f(ds.get("longitude"))
    at_home = None
    if lat is not None and lng is not None:
        at_home = _haversine_m(lat, lng, HOME_LAT, HOME_LNG) <= HOME_RADIUS_M

    charger_w = _f(cs.get("charger_power"))  # Tesla reports this in kW already
    return {
        "charging_state": cs.get("charging_state"),
        "charge_power_kw": charger_w,
        "charge_rate_kw": _f(cs.get("charge_rate")),
        "battery_level": _f(cs.get("battery_level")),
        "charge_energy_added_kwh": _f(cs.get("charge_energy_added")),
        "charge_limit_soc": _f(cs.get("charge_limit_soc")),
        "at_home": at_home,
    }


def collect_growatt(cfg: dict) -> dict:
    """Original 6.6 kW array. Two paths, chosen by what's configured:

    - GROWATT_API_TOKEN set (PREFERRED, and what's in use): the official
      token-authenticated OpenAPI V1. No login, so it sidesteps both the
      IP-block that stops the legacy endpoint working from CI and any
      login-frequency risk. Verified live against the real plant.
    - otherwise: the legacy ShinePhone username/password API (unofficial,
      reverse-engineered). Growatt 403s this from GitHub Actions' IPs
      specifically; works fine from a home IP. GROWATT_PROXY_URL can route
      through a Cloudflare Worker if Growatt's IP-block turns out to be scoped
      to the reverse-engineered endpoints rather than the whole host — see
      collector git history for why that attempt didn't pan out.
    """
    token = cfg.get("GROWATT_API_TOKEN")
    if token:
        return collect_growatt_v1(token, cfg.get("GROWATT_PLANT_ID"))

    api = growattServer.GrowattApi(add_random_user_id=True)
    proxy = cfg.get("GROWATT_PROXY_URL")
    if proxy:
        api.server_url = proxy if proxy.endswith("/") else proxy + "/"
        secret = cfg.get("INGEST_SECRET", "")
        if secret:
            api.session.headers.update({"x-proxy-secret": secret})
    try:
        login = api.login(cfg["GROWATT_USERNAME"], cfg["GROWATT_PASSWORD"])
    except Exception as e:  # noqa: BLE001
        # Surface the server's own response body — a bare status code hides
        # whether the rejection came from Growatt or from the proxy in front.
        body = getattr(getattr(e, "response", None), "text", None)
        sent = sorted(api.session.headers.keys())
        raise RuntimeError(f"{e} | body={body!r} | sent_headers={sent}") from e
    if isinstance(login, dict) and not login.get("success", True):
        raise RuntimeError(f"growatt login failed: {login.get('msg')}")
    uid = (login.get("user") or {}).get("id") or login.get("userId")
    plants = api.plant_list(uid)
    data = plants.get("data") if isinstance(plants, dict) else plants
    if not data:
        raise RuntimeError("growatt: no plants")
    pid = data[0].get("plantId") or data[0].get("id")

    # Plant-level currentPower is laggy/unreliable; read live AC power off the
    # inverter itself (device_list 'power' is in watts, 'eToday' in kWh).
    dl = api.device_list(pid)
    devs = dl.get("data") if isinstance(dl, dict) else dl
    inv = next((d for d in (devs or []) if d.get("deviceType") == "inverter"), (devs or [{}])[0])
    power_w = _f(inv.get("power"))
    return {
        "solar_old_kw": (power_w / 1000.0) if power_w is not None else parse_qty(inv.get("powerStr")),
        "solar_old_kwh_today": _f(inv.get("eToday")),
    }


def collect_growatt_v1(token: str, plant_id_hint: str | int | None = None) -> dict:
    """Original array via Growatt's official token-authenticated OpenAPI V1.

    No login at all — a static token in a header — so none of the
    account-lockout or IP-block problems the reverse-engineered ShinePhone
    endpoint has. This is the path that finally works from CI.

    `plant/energy` returns current power and today's total together, which is
    everything we need from one call. Note the units differ between endpoints:
    plant_energy_overview reports current_power in kW, while plant_list reports
    it in WATTS — verified against the same instant (3.07 vs "3068.9").
    """
    from growattServer.open_api_v1 import OpenApiV1

    from growattServer.exceptions import GrowattV1ApiError

    api = OpenApiV1(token)
    try:
        # The plant id never changes, so it can be supplied directly to avoid a
        # second API call every cycle — Growatt rate-limits per plant and the
        # lookup is pure overhead once known.
        plant_id = plant_id_hint or None
        if plant_id is None:
            plants = (api.plant_list() or {}).get("plants") or []
            if not plants:
                raise RuntimeError("growatt v1: no plants on this token")
            plant_id = plants[0].get("plant_id") or plants[0].get("id")

        ov = api.plant_energy_overview(plant_id) or {}
    except GrowattV1ApiError as e:
        # The library's message alone doesn't say *why*; code 10012 is
        # 'error_frequently_access' (rate limit), which is by far the most
        # common cause and is otherwise indistinguishable from a real fault.
        raise RuntimeError(
            f"growatt v1: {e} (code={getattr(e, 'error_code', None)} "
            f"msg={getattr(e, 'error_msg', None)})"
        ) from e

    return {
        "solar_old_kw": _f(ov.get("current_power")),      # kW on this endpoint
        "solar_old_kwh_today": _f(ov.get("today_energy")),
    }


async def collect_anker(cfg: dict) -> dict:
    """New 6.16 kW array + 10 kWh battery + grid/consumption via Anker SOLIX X1.

    Restores the anker-solix-api library's own login-token cache from KV
    before authenticating, and saves it back afterwards. GitHub Actions
    runners start from a blank filesystem every run, so without this the
    collector was doing a fresh username/password login every 5-min poll —
    Anker rate-limits/CAPTCHAs an account after roughly 10 logins/day, and a
    prior version of this script triggered exactly that after ~570 logins in
    2 days. The library itself already supports a ~7-day-valid cached token;
    this just gives it somewhere to persist between stateless CI runs.
    """
    country = cfg.get("ANKER_COUNTRY", "AU")
    async with ClientSession() as ws:
        myapi = AnkerSolixApi(cfg["ANKER_EMAIL"], cfg["ANKER_PASSWORD"], country, ws, log)
        # Belt-and-braces: cap requests per endpoint per minute well under
        # Anker's ~10-12/min so we can never trip their limiter.
        myapi.endpointLimit(5)

        global _anker_cache_loaded, _anker_cache_path
        cache_path = Path(myapi.apisession._authFile)  # noqa: SLF001 — intentional: no public accessor for this path
        _anker_cache_path = cache_path
        if not _anker_cache_loaded:
            cached_blob = load_anker_cache_blob(cfg)
            if cached_blob:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(cached_blob)
            _anker_cache_loaded = True

        try:
            hes = AnkerSolixHesApi(apisession=myapi.apisession)
            hes.endpointLimit(5)
            await hes.update_sites()
            try:
                await hes.update_site_details()
            except Exception as e:  # noqa: BLE001
                log.warning("anker site_details: %s", e)

            if not hes.sites:
                raise RuntimeError("anker: no HES site found")
            site = next(iter(hes.sites.values()))
            today = (site.get("energy_details") or {}).get("today") or {}

            # The X1 inverter device is the one exposing average_power (kW).
            inv = next((d for d in hes.devices.values() if "average_power" in d), {})
            ap = inv.get("average_power") or {}

            return {
                "solar_new_kw": _f(ap.get("solar_power_avg")),
                "battery_soc": _f(ap.get("state_of_charge")),
                "battery_charge_kw": _f(ap.get("charge_power_avg")),
                "battery_discharge_kw": _f(ap.get("discharge_power_avg")),
                "grid_import_kw": _f(ap.get("grid_import_avg")),
                "grid_export_kw": _f(ap.get("grid_export_avg")),
                "solar_new_kwh_today": _f(today.get("solar_production")),
                "grid_import_kwh_today": _f(today.get("grid_import")),
                "grid_export_kwh_today": _f(today.get("solar_to_grid")),
                "battery_charge_kwh_today": _f(today.get("battery_charge")),
                "battery_discharge_kwh_today": _f(today.get("battery_discharge")),
                # Anker's own flow accounting — where power actually went,
                # rather than leaving it to be derived downstream.
                "solar_to_home_kwh_today": _f(today.get("solar_to_home")),
                "solar_to_battery_kwh_today": _f(today.get("solar_to_battery")),
                "battery_to_home_kwh_today": _f(today.get("battery_to_home")),
                "grid_to_home_kwh_today": _f(today.get("grid_to_home")),
                "home_usage_kwh_today": _f(today.get("home_usage")),
            }
        finally:
            pass  # token is persisted once per process; see persist_anker_cache()


def persist_anker_cache(cfg: dict) -> None:
    """Push whatever token is on disk back to KV. Called once at process exit
    (including after failures) so a fresh login isn't lost if a later call in
    the same run errors out."""
    if _anker_cache_path is not None and _anker_cache_path.is_file():
        save_anker_cache_blob(cfg, _anker_cache_path.read_text())


async def collect_once(cfg: dict, include_slow: bool = True) -> dict:
    """`include_slow` controls the ~5-minute-granularity sources (Growatt and
    Tesla), which both rate-limit and gain nothing from faster polling. Anker
    is read on every sample since it genuinely updates about once a minute."""
    payload: dict = {}
    sources: list[str] = []

    # Growatt (sync) in a thread so it doesn't block the loop.
    #
    # In CI this is skipped entirely (GROWATT_SKIP=1): Growatt refuses
    # datacenter IPs, so the call can only ever fail from here. The companion
    # Cloudflare Worker fetches it instead and /api/ingest merges that snapshot.
    # Left enabled by default so a run from a home IP still works directly.
    global _growatt_cache
    if cfg.get("GROWATT_SKIP"):
        pass
    elif include_slow:
        try:
            _growatt_cache = await asyncio.to_thread(collect_growatt, cfg)
        except Exception as e:  # noqa: BLE001
            log.error("growatt collect failed: %s", e)
    if _growatt_cache:
        payload.update(_growatt_cache)
        sources.append("growatt")

    try:
        a = await collect_anker(cfg)
        payload.update(a)
        sources.append("anker")
    except Exception as e:  # noqa: BLE001
        log.error("anker collect failed: %s", e)

    # Tesla is posted to its own endpoint (different table), so it doesn't
    # join the energy payload — but note it in sources for visibility.
    #
    # Deliberately only once per run, not once per sample: reading vehicle_data
    # won't wake a sleeping car (it returns 408), but polling an awake one every
    # ~60s stops it going back to sleep and drains the battery. Charge power
    # moves slowly enough that 5-minute resolution is plenty.
    if not include_slow:
        payload["sources"] = ",".join(sources)
        return payload
    try:
        t = await asyncio.to_thread(collect_tesla, cfg)
        if t is not None:
            payload["_tesla"] = t
            sources.append("tesla")
    except Exception as e:  # noqa: BLE001
        log.error("tesla collect failed: %s", e)

    payload["sources"] = ",".join(sources)
    return payload


def post_tesla_state(cfg: dict, tesla: dict) -> None:
    base = _kv_base_url(cfg)
    body = json.dumps(tesla).encode()
    req = urllib.request.Request(
        base + "/api/ingest/tesla-state", data=body, method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg.get('INGEST_SECRET', '')}",
            "user-agent": "ericlau-energy-collector/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"   -> tesla {resp.status} {resp.read().decode()[:120]}")


def post_reading(cfg: dict, payload: dict) -> None:
    url = cfg.get("INGEST_URL", "http://localhost:3000/api/ingest")
    payload = {k: v for k, v in payload.items() if k != "_tesla"}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg.get('INGEST_SECRET', '')}",
            # Cloudflare's edge blocks the default python-urllib UA as a bot (403).
            "user-agent": "ericlau-energy-collector/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"   -> {resp.status} {resp.read().decode()[:200]}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="run a single cycle")
    ap.add_argument("--dry-run", action="store_true", help="print payload, do not POST")
    # Multi-sample mode: take several readings within ONE process, spaced by
    # --gap. Anker's cloud values move at roughly 1-minute granularity, so this
    # is how the dashboard gets ~1-minute resolution without needing a CI run
    # per minute — one 5-minute run captures ~4 samples, reusing a single
    # authenticated session (no extra logins) for all of them.
    ap.add_argument("--samples", type=int, default=1, help="readings per run (default 1)")
    ap.add_argument("--gap", type=int, default=60, help="seconds between samples (default 60, min 30)")
    # Only used in the long-running loop mode (not CI). Anker rate-limits per
    # endpoint per minute; the floor keeps us clear of it.
    ap.add_argument("--interval", type=int, default=300, help="loop seconds (default 300, min 120)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")
    cfg = load_config()
    missing = [k for k in ("ANKER_EMAIL", "ANKER_PASSWORD", "GROWATT_USERNAME", "GROWATT_PASSWORD") if not cfg.get(k)]
    if missing:
        print(f"!! missing config: {missing}", file=sys.stderr)
        sys.exit(1)

    samples = max(1, args.samples)
    gap = max(30, args.gap)

    try:
        while True:
            t0 = time.time()
            for i in range(samples):
                if i:
                    await asyncio.sleep(gap)
                payload = await collect_once(cfg, include_slow=(i == 0))
                print(f"[{time.strftime('%H:%M:%S')}] ({i + 1}/{samples}) "
                      f"sources={payload.get('sources')!r} "
                      f"solar_new={payload.get('solar_new_kw')} solar_old={payload.get('solar_old_kw')} "
                      f"soc={payload.get('battery_soc')} grid_imp={payload.get('grid_import_kw')}")
                if args.dry_run:
                    print(json.dumps(payload, indent=2))
                else:
                    try:
                        post_reading(cfg, payload)
                    except Exception as e:  # noqa: BLE001
                        log.error("post failed: %s", e)
                    if payload.get("_tesla"):
                        try:
                            post_tesla_state(cfg, payload["_tesla"])
                        except Exception as e:  # noqa: BLE001
                            log.error("tesla post failed: %s", e)
            if args.once:
                break
            # Never poll faster than every 2 min, whatever was requested.
            interval = max(120, args.interval)
            await asyncio.sleep(max(10, interval - (time.time() - t0)))
    finally:
        if not args.dry_run:
            persist_anker_cache(cfg)


if __name__ == "__main__":
    asyncio.run(main())
