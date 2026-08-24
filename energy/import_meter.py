#!/usr/bin/env python3
"""Import Powercor myEnergy CSV exports into the meter_intervals / meter_billing_periods
D1 tables — the billing-grade source of truth for the energy dashboard.

Two myEnergy exports are supported (pass either or both):
  *_interval.csv  30-min consumption/generation rows (-> meter_intervals)
  *_basic.csv     billed Peak/Off Peak/Solar period totals (-> meter_billing_periods)

Streams: 'consumption' -> import (register E1), 'generation' -> export (B1).
Dates in the exports are dd/mm/yyyy; stored as YYYY-MM-DD (Australia/Melbourne).

Usage:
  python import_meter.py --interval FILE --basic FILE            # POST to INGEST_URL
  python import_meter.py --interval FILE --basic FILE --dry-run  # parse + summarize only
  python import_meter.py --interval FILE --basic FILE --sql out.sql  # emit SQL for
      #   wrangler d1 execute ericlau-energy --remote --file out.sql
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

DEVVARS = os.environ.get(
    "DEVVARS_PATH",
    str(Path(__file__).resolve().parent.parent / ".dev.vars"),
)
STREAM = {"consumption": "import", "generation": "export"}


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


def _date(s: str) -> str:
    return datetime.strptime(s.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")


def read_intervals(path: Path) -> list[dict]:
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r)
        cols = header[6:]  # 48 'HH:MM-HH:MM' labels
        starts = [c.split("-", 1)[0] for c in cols]
        for row in r:
            if not row or row[0].strip() == "":
                continue
            quality = row[1].strip()
            date = _date(row[3])
            stream = STREAM.get(row[5].strip().lower())
            if stream is None:
                continue
            for start, val in zip(starts, row[6 : 6 + len(cols)]):
                out.append(
                    {
                        "local_date": date,
                        "interval_start": start,
                        "stream": stream,
                        "kwh": float(val),
                        "quality": quality or None,
                    }
                )
    return out


def read_periods(path: Path) -> list[dict]:
    # basic.csv is long-form (one row per tariff); pivot to one row per period.
    periods: dict[tuple[str, str], dict] = {}
    key_for = {"peak": "peak_kwh", "off peak": "offpeak_kwh", "solar": "solar_kwh"}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            fr, to = _date(row["from_date"]), _date(row["to_date"])
            p = periods.setdefault(
                (fr, to),
                {"from_date": fr, "to_date": to, "peak_kwh": None, "offpeak_kwh": None, "solar_kwh": None},
            )
            col = key_for.get(row["tariff_description"].strip().lower())
            if col:
                p[col] = float(row["quantity"])
    return list(periods.values())


def _sql_lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    return repr(v)


def emit_sql(intervals: list[dict], periods: list[dict], out: Path) -> None:
    # No BEGIN/COMMIT: `wrangler d1 execute --file` runs the whole file in one
    # transaction itself and rejects explicit BEGIN/SAVEPOINT statements.
    lines: list[str] = []
    B = 500
    for i in range(0, len(intervals), B):
        chunk = intervals[i : i + B]
        vals = ",".join(
            f"({_sql_lit(x['local_date'])},{_sql_lit(x['interval_start'])},"
            f"{_sql_lit(x['stream'])},{x['kwh']},{_sql_lit(x['quality'])})"
            for x in chunk
        )
        lines.append(
            "INSERT OR REPLACE INTO meter_intervals "
            "(local_date,interval_start,stream,kwh,quality) VALUES " + vals + ";"
        )
    for p in periods:
        lines.append(
            "INSERT OR REPLACE INTO meter_billing_periods "
            "(from_date,to_date,peak_kwh,offpeak_kwh,solar_kwh) VALUES "
            f"({_sql_lit(p['from_date'])},{_sql_lit(p['to_date'])},"
            f"{p['peak_kwh']},{p['offpeak_kwh']},{p['solar_kwh']});"
        )
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({len(intervals)} intervals, {len(periods)} periods)")


def post(cfg: dict, payload: dict) -> None:
    url = cfg.get("INGEST_URL", "http://localhost:3000/api/ingest/meter")
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {cfg.get('INGEST_SECRET', '')}",
            "user-agent": "ericlau-energy-collector/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"-> {resp.status} {resp.read().decode()[:300]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=Path)
    ap.add_argument("--basic", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sql", type=Path, help="emit SQL to this path instead of POSTing")
    args = ap.parse_args()

    if not args.interval and not args.basic:
        ap.error("pass --interval and/or --basic")

    intervals = read_intervals(args.interval) if args.interval else []
    periods = read_periods(args.basic) if args.basic else []

    if intervals:
        dates = sorted({x["local_date"] for x in intervals})
        imp = sum(x["kwh"] for x in intervals if x["stream"] == "import")
        exp = sum(x["kwh"] for x in intervals if x["stream"] == "export")
        quals = sorted({x["quality"] for x in intervals if x["quality"]})
        print(f"intervals: {len(intervals)} rows, {dates[0]}..{dates[-1]} ({len(dates)} days)")
        print(f"  import {imp:,.0f} kWh, export {exp:,.0f} kWh, quality={quals}")
    if periods:
        print(f"periods: {len(periods)}  ({periods[0]['from_date']}..{periods[-1]['to_date']})")

    if args.sql:
        emit_sql(intervals, periods, args.sql)
        return
    if args.dry_run:
        print("\n(dry run — nothing sent)")
        return

    cfg = load_config()
    B = 2000  # keep request bodies reasonable
    for i in range(0, len(intervals), B):
        post(cfg, {"intervals": intervals[i : i + B]})
        print(f"  intervals {min(i + B, len(intervals))}/{len(intervals)}")
    if periods:
        post(cfg, {"periods": periods})


if __name__ == "__main__":
    main()
