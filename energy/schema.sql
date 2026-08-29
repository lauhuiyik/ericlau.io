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


-- Daily totals look up the last non-null value per column per date, which is an
-- ordered scan within one date. The local_date-only index leaves that as a sort.
CREATE INDEX IF NOT EXISTS idx_readings_date_ts ON readings (local_date, ts DESC);


-- ---------------------------------------------------------------------------
-- Powercor smart-meter data — the BILLING-GRADE source of truth.
--
-- `readings` above is derived in real time from the Anker/Growatt CT clamps;
-- it's live but slightly under-reads grid import (~1% on clean days, more on
-- days the collector missed part of). The tables below are the revenue meter
-- the bill is actually calculated from, imported from the myEnergy portal CSV
-- exports (NMI 62038089177, meter DZ114328). 30-minute resolution, ~1 day in
-- arrears — so it can't drive the live view, but it's exact for reconciliation.
--
-- Streams map to the NEM12 registers / myEnergy tariff_description:
--   import  = 'consumption' = register E1 (grid draw, what you're billed for)
--   export  = 'generation'  = register B1 (solar feed-in / FIT credit)
CREATE TABLE IF NOT EXISTS meter_intervals (
  local_date     TEXT NOT NULL,   -- 'YYYY-MM-DD' (Australia/Melbourne)
  interval_start TEXT NOT NULL,   -- 'HH:MM' local, start of the 30-min block
  stream         TEXT NOT NULL,   -- 'import' | 'export'
  kwh            REAL NOT NULL,
  quality        TEXT,            -- 'Actual' | 'Estimated' | 'Substituted' ...
  PRIMARY KEY (local_date, interval_start, stream)
);
CREATE INDEX IF NOT EXISTS idx_meter_intervals_date ON meter_intervals (local_date);

-- Billed period totals straight from the myEnergy 'basic' export — the exact
-- quantities that appear on the Lumo bill (Peak / Off Peak / Solar). Kept
-- alongside the intervals so a bill can be reconciled against it directly
-- without re-deriving the peak window. Cycle runs the 18th → 17th.
CREATE TABLE IF NOT EXISTS meter_billing_periods (
  from_date   TEXT NOT NULL,      -- 'YYYY-MM-DD' inclusive
  to_date     TEXT NOT NULL,      -- 'YYYY-MM-DD' inclusive
  peak_kwh    REAL,               -- billed Peak import
  offpeak_kwh REAL,               -- billed Off Peak import
  solar_kwh   REAL,               -- billed Solar export (feed-in)
  PRIMARY KEY (from_date, to_date)
);


-- ---------------------------------------------------------------------------
-- GAS — Lumo "Lumo Value", tariff zone "AGL North". MIRN 5330779554,
-- meter 9724XJ-000:1. Same retailer and account family as the electricity above.
--
-- IMPORTANT: unlike electricity there is NO interval data for gas. The meter is
-- read roughly every two months and the invoice states consumption is
-- "apportioned evenly over number of days", so any daily / seasonal figure is
-- DERIVED from a bi-monthly read, never measured. Don't build time-of-day
-- analysis on it.
--
-- Rates (incl GST, fixed until 30 Sep 2026):
--   Summer $0.02838/MJ   applies 1 Oct - 31 May
--   Winter $0.03542/MJ   applies 1 Jun - 30 Sep
--   Supply $1.012/day    year-round, both seasons
-- Only "Step1" ever appears on the invoices — the declining-block step 2 is
-- never reached, even at 3,799 MJ in a 57-day winter period. Treat as flat.
-- Billed MJ = base usage (m3) x heating value x pressure factor (1.0272);
-- heating value drifts per period (37.74 - 38.66 observed).

-- One row per meter read, straight from the myEnergy gas CSV export.
CREATE TABLE IF NOT EXISTS gas_billing_periods (
  from_date TEXT NOT NULL,
  to_date   TEXT NOT NULL,
  days      INTEGER,
  mj        REAL,
  season    TEXT,              -- label on the read; the invoice may still split
                               -- a period across the 1 Jun / 1 Oct boundary
  PRIMARY KEY (from_date, to_date)
);

-- One row per charged segment on an actual invoice. A single bill can carry two
-- segments when the period straddles a season change, so this is finer-grained
-- than gas_billing_periods and is the source of truth for rates actually paid.
CREATE TABLE IF NOT EXISTS gas_bill_segments (
  invoice        TEXT NOT NULL,
  from_date      TEXT NOT NULL,
  to_date        TEXT NOT NULL,
  days           INTEGER,
  season         TEXT,
  mj             REAL,
  rate_per_mj    REAL,
  energy_cost    REAL,
  supply_per_day REAL,
  supply_cost    REAL,
  PRIMARY KEY (invoice, from_date, to_date)
);
