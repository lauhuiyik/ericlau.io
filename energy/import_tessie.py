#!/usr/bin/env python3
"""Import a Tessie charging-history CSV export into the tesla_charges D1 table.

Tessie export columns (AEST timestamps, local Melbourne time year-round-ish —
AEST has no DST so this is exactly Australia/Melbourne standard time; Victoria
does observe DST (AEDT) part of the year, so timestamps in that window are
technically off by an hour from local clock time — noted, not corrected, since
Tessie always labels the column AEST and kWh/energy fields are unaffected).

Usage:
  python import_tessie.py /path/to/export.csv                # POST to INGEST_URL
  python import_tessie.py /path/to/export.csv --dry-run       # parse + summarize only
  python import_tessie.py /path/to/export.csv --db-file ./x.sqlite  # local sqlite3 test
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

DEVVARS = os.environ.get(
    "DEVVARS_PATH",
    str(Path(__file__).resolve().parent.parent / ".dev.vars"),
)

# 36 Australis Dr, Williams Landing VIC 3027 (from the solar proposals).
HOME_LAT = -37.860447
HOME_LNG = 144.742980
HOME_RADIUS_M = 150


def load_config() -> dict:
    cfg: dict[str, str] = {}
    p = Path(DEVVARS)
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    for k in ("INGEST_SECRET", "INGEST_URL"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    return cfg


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _f(v) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_row(row: dict) -> dict | None:
    started = row.get("Started At (AEST)")
    ended = row.get("Ended At (AEST)")
    if not started:
        return None
    try:
        start_dt = datetime.strptime(started, "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    end_dt = None
    if ended:
        try:
            end_dt = datetime.strptime(ended, "%Y-%m-%d %H:%M")
        except ValueError:
            pass

    lat = _f(row.get("Latitude"))
    lng = _f(row.get("Longitude"))
    saved = (row.get("Saved Location") or "").strip()
    at_home = saved.lower() == "home"
    if not at_home and lat is not None and lng is not None:
        at_home = haversine_m(lat, lng, HOME_LAT, HOME_LNG) <= HOME_RADIUS_M

    # A stable id: VIN isn't in the CSV, but start+end timestamp pair is unique enough.
    charge_id = f"tessie:{started}:{ended or ''}"

    return {
        "id": charge_id,
        "started_ts": int(start_dt.timestamp()),
        "ended_ts": int(end_dt.timestamp()) if end_dt else None,
        "local_date": started[:10],
        "energy_added_kwh": _f(row.get("Energy Added (kWh)")),
        "location": row.get("Location") or saved or None,
        "at_home": 1 if at_home else 0,
        "odometer_km": _f(row.get("Odometer (km)")),
        "cost_aud": _f(row.get("Cost")),
        "source": "tessie",
    }


def read_charges(csv_path: Path) -> list[dict]:
    out = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            parsed = parse_row(row)
            if parsed:
                out.append(parsed)
    return out


def post_batch(cfg: dict, charges: list[dict]) -> None:
    url = cfg.get("INGEST_URL", "http://localhost:3000/api/ingest/tesla-charges")
    body = json.dumps({"charges": charges}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg.get('INGEST_SECRET', '')}",
            # Cloudflare's edge blocks the default python-urllib UA as a bot (403).
            "user-agent": "ericlau-energy-collector/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"-> {resp.status} {resp.read().decode()[:500]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.csv_path.exists():
        print(f"!! not found: {args.csv_path}", file=sys.stderr)
        sys.exit(1)

    charges = read_charges(args.csv_path)
    home_n = sum(1 for c in charges if c["at_home"])
    total_kwh = sum(c["energy_added_kwh"] or 0 for c in charges)
    home_kwh = sum(c["energy_added_kwh"] or 0 for c in charges if c["at_home"])
    dates = sorted(c["local_date"] for c in charges if c["local_date"])

    print(f"Parsed {len(charges)} charging sessions ({dates[0]} .. {dates[-1]})")
    print(f"  at home: {home_n} ({home_n / len(charges) * 100:.0f}%) — {home_kwh:.0f} kWh")
    print(f"  away:    {len(charges) - home_n} — {total_kwh - home_kwh:.0f} kWh")
    print(f"  total energy added: {total_kwh:.0f} kWh")

    if args.dry_run:
        print("\n(dry run — nothing sent)")
        print(json.dumps(charges[:2], indent=2))
        return

    cfg = load_config()
    # Batch to keep request bodies reasonable.
    BATCH = 200
    for i in range(0, len(charges), BATCH):
        batch = charges[i : i + BATCH]
        post_batch(cfg, batch)
        print(f"  imported {min(i + BATCH, len(charges))}/{len(charges)}")


if __name__ == "__main__":
    main()
