-- Home energy dashboard — Cloudflare D1 (SQLite) schema
-- Time-series of ~5-min snapshots combining the Anker X1 (new array + battery + grid CT)
-- and the Growatt inverter (original array). One row per collector poll.
--
-- Units: *_kw = instantaneous power (kW). *_kwh_today = running energy total for the
-- LOCAL (Australia/Melbourne) day, as reported by each system. Signs are avoided by
-- splitting import/export and charge/discharge into separate non-negative columns.

CREATE TABLE IF NOT EXISTS readings (
  ts                          INTEGER PRIMARY KEY,  -- unix epoch seconds, UTC
  local_date                  TEXT    NOT NULL,     -- 'YYYY-MM-DD' in Australia/Melbourne
  local_time                  TEXT    NOT NULL,     -- 'HH:MM' in Australia/Melbourne (convenience)

  -- Instantaneous power (kW)
  solar_new_kw                REAL,                 -- Anker X1 PV
  solar_old_kw                REAL,                 -- Growatt PV
  solar_total_kw              REAL,                 -- solar_new_kw + solar_old_kw (precomputed)
  battery_soc                 REAL,                 -- %
  battery_charge_kw           REAL,                 -- >0 while charging
  battery_discharge_kw        REAL,                 -- >0 while discharging
  grid_import_kw              REAL,                 -- >0 drawing from grid
  grid_export_kw              REAL,                 -- >0 feeding grid
  house_kw                    REAL,                 -- derived whole-home consumption

  -- Running energy totals for the local day (kWh)
  solar_new_kwh_today         REAL,
  solar_old_kwh_today         REAL,
  grid_import_kwh_today       REAL,
  grid_export_kwh_today       REAL,
  battery_charge_kwh_today    REAL,
  battery_discharge_kwh_today REAL,
  house_kwh_today             REAL,                 -- derived

  -- Where energy actually flowed, straight from Anker rather than derived.
  -- Answers "where did my power come from / where did my solar go" directly,
  -- and cross-checks house_kwh_today (verified 2026-07-31: derived 95.64 vs
  -- Anker's own home_usage 95.63).
  solar_to_home_kwh_today     REAL,
  solar_to_battery_kwh_today  REAL,
  battery_to_home_kwh_today   REAL,
  grid_to_home_kwh_today      REAL,
  -- Anker's OWN whole-home figure. It cannot see the Growatt array, so it
  -- under-reports while that array generates; house_kwh_today adds it back
  -- and is the truer total.
  home_usage_kwh_today        REAL,

  sources                     TEXT                  -- which systems reported OK, e.g. 'anker,growatt'
);

CREATE INDEX IF NOT EXISTS idx_readings_local_date ON readings (local_date);

-- Optional end-of-day rollup (populated later from readings) for fast long-range charts
-- and bill reconciliation against Lumo tariffs.
CREATE TABLE IF NOT EXISTS daily_summary (
  local_date                  TEXT PRIMARY KEY,
  solar_new_kwh               REAL,
  solar_old_kwh               REAL,
  solar_total_kwh             REAL,
  grid_import_kwh             REAL,
  grid_export_kwh             REAL,
  battery_charge_kwh          REAL,
  battery_discharge_kwh       REAL,
  house_kwh                   REAL,
  -- $ using the stored Lumo tariff (peak/offpeak/supply/FiT); computed on rollup
  cost_aud                    REAL,
  feed_in_credit_aud          REAL,
  updated_ts                  INTEGER
);

-- Tesla live vehicle/charging state, sampled alongside energy readings.
CREATE TABLE IF NOT EXISTS tesla_state (
  ts                       INTEGER PRIMARY KEY,  -- unix epoch seconds, UTC
  local_date               TEXT NOT NULL,
  local_time               TEXT NOT NULL,
  charging_state           TEXT,                 -- Charging / Complete / Disconnected / Stopped / NoPower
  charge_power_kw          REAL,                 -- charger_power right now
  charge_rate_kw           REAL,
  battery_level            REAL,                 -- vehicle SOC %
  charge_energy_added_kwh  REAL,                 -- added this session
  charge_limit_soc         REAL,
  at_home                  INTEGER,              -- 1 if within ~150 m of home
  source                   TEXT                  -- 'fleet' | 'tessie'
);
CREATE INDEX IF NOT EXISTS idx_tesla_state_local_date ON tesla_state (local_date);

-- Completed charging sessions (from Tessie history export, or derived from live state).
CREATE TABLE IF NOT EXISTS tesla_charges (
  id                       TEXT PRIMARY KEY,     -- Tessie id, or derived 'start_ts'
  started_ts               INTEGER,
  ended_ts                 INTEGER,
  local_date               TEXT,
  energy_added_kwh         REAL,
  location                 TEXT,
  at_home                  INTEGER,
  odometer_km              REAL,
  cost_aud                 REAL,
  source                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tesla_charges_local_date ON tesla_charges (local_date);

