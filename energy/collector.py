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
        "GROWATT_API_TOKEN",
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


def collect_growatt(cfg: dict) -> dict:
    """Original 6.6 kW array. Two paths, chosen by what's configured:

    - GROWATT_API_TOKEN set: the official token-authenticated OpenAPI V1
      (no login at all — a static token in a header). This is the sanctioned,
      sustainable path; obtained by asking the installer to apply for a
      personal API token via Growatt's OSS system. NOT YET LIVE-TESTED end to
      end (no token available while writing this) — verify the field names
      in plant_power_overview's response before trusting it blindly.
    - otherwise: the legacy ShinePhone username/password API (unofficial,
      reverse-engineered). Growatt 403s this from GitHub Actions' IPs
      specifically; works fine from a home IP. GROWATT_PROXY_URL can route
      through a Cloudflare Worker if Growatt's IP-block turns out to be scoped
      to the reverse-engineered endpoints rather than the whole host — see
      collector git history for why that attempt didn't pan out.
    """
    token = cfg.get("GROWATT_API_TOKEN")
    if token:
        return collect_growatt_v1(token)

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


def collect_growatt_v1(token: str) -> dict:
    """Via Growatt's official token-authenticated OpenAPI V1 — no login, so
    none of the account-lockout risk the legacy path carries. UNTESTED
    end-to-end (no token available yet); the plant_power_overview response
    shape is defensively parsed rather than assumed."""
    from growattServer.open_api_v1 import OpenApiV1

    api = OpenApiV1(token)
    plants = (api.plant_list() or {}).get("plants") or []
    if not plants:
        raise RuntimeError("growatt v1: no plants")
    plant_id = plants[0].get("plant_id") or plants[0].get("id")

    overview = api.plant_power_overview(plant_id) or {}
    powers = overview.get("powers") or []
    latest = next((p for p in reversed(powers) if p.get("power") is not None), None)
    power_w = _f(latest.get("power")) if latest else None

    # today's energy total — field name unconfirmed without a real token;
    # try the plant_list entry's own summary field(s) as a best effort.
    today_kwh = _f(
        plants[0].get("today_energy")
        or plants[0].get("todayEnergy")
        or plants[0].get("e_today"),
    )

    return {
        "solar_old_kw": (power_w / 1000.0) if power_w is not None else None,
        "solar_old_kwh_today": today_kwh,
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

        cache_path = Path(myapi.apisession._authFile)  # noqa: SLF001 — intentional: no public accessor for this path
        cached_blob = load_anker_cache_blob(cfg)
        if cached_blob:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(cached_blob)

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
            }
        finally:
            # Persist whatever token is now on disk (fresh or reused) even if
            # the calls above failed partway through — a successful login
            # followed by a later error would otherwise lose the fresh token.
            if cache_path.is_file():
                save_anker_cache_blob(cfg, cache_path.read_text())


async def collect_once(cfg: dict) -> dict:
    payload: dict = {}
    sources: list[str] = []

    # Growatt (sync) in a thread so it doesn't block the loop.
    try:
        g = await asyncio.to_thread(collect_growatt, cfg)
        payload.update(g)
        sources.append("growatt")
    except Exception as e:  # noqa: BLE001
        log.error("growatt collect failed: %s", e)

    try:
        a = await collect_anker(cfg)
        payload.update(a)
        sources.append("anker")
    except Exception as e:  # noqa: BLE001
        log.error("anker collect failed: %s", e)

    payload["sources"] = ",".join(sources)
    return payload


def post_reading(cfg: dict, payload: dict) -> None:
    url = cfg.get("INGEST_URL", "http://localhost:3000/api/ingest")
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
    # 300 s is deliberately conservative. Anker rate-limits ~10-12 requests per
    # IP per minute and each cycle makes several calls; the Growatt datalogger
    # only reports every 5 min anyway, so faster polling gains nothing and
    # risks the account being throttled or blocked. Enforced floor below.
    ap.add_argument("--interval", type=int, default=300, help="loop seconds (default 300, min 120)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")
    cfg = load_config()
    missing = [k for k in ("ANKER_EMAIL", "ANKER_PASSWORD", "GROWATT_USERNAME", "GROWATT_PASSWORD") if not cfg.get(k)]
    if missing:
        print(f"!! missing config: {missing}", file=sys.stderr)
        sys.exit(1)

    while True:
        t0 = time.time()
        payload = await collect_once(cfg)
        print(f"[{time.strftime('%H:%M:%S')}] sources={payload.get('sources')!r} "
              f"solar_new={payload.get('solar_new_kw')} solar_old={payload.get('solar_old_kw')} "
              f"soc={payload.get('battery_soc')} grid_imp={payload.get('grid_import_kw')}")
        if args.dry_run:
            print(json.dumps(payload, indent=2))
        else:
            try:
                post_reading(cfg, payload)
            except Exception as e:  # noqa: BLE001
                log.error("post failed: %s", e)
        if args.once:
            break
        # Never poll faster than every 2 min, whatever was requested.
        interval = max(120, args.interval)
        await asyncio.sleep(max(10, interval - (time.time() - t0)))


if __name__ == "__main__":
    asyncio.run(main())
