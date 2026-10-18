/**
 * Personal finance tracker — pure parsing, categorising and budgeting logic.
 *
 * PRIVACY: this repo is public. Nothing personal belongs in this file — no
 * transactions, merchants specific to one person, budget targets, income or
 * cardholder names. Those live in a "profile" JSON the owner imports in the
 * browser; transactions are parsed client-side and only ever saved encrypted
 * with the owner's passphrase (src/lib/vault-*.ts). Only generic, chain-level
 * merchant patterns are hard-coded.
 */

export const BUCKETS = [
  { id: "food", label: "Food" },
  { id: "bills", label: "Subscriptions & bills" },
  { id: "entertainment", label: "Entertainment" },
  { id: "others", label: "Others" },
  { id: "travel", label: "Travel" },
] as const;

export type Bucket = (typeof BUCKETS)[number]["id"];
/** What a rule or override can assign: a budget bucket, or exclude the row. */
export type Assignment = Bucket | "transfer" | "ignore";

export const BUCKET_IDS = new Set<string>(BUCKETS.map((b) => b.id));
export const bucketLabel = (id: string) =>
  BUCKETS.find((b) => b.id === id)?.label ?? (id === "uncategorised" ? "Uncategorised" : id);

/**
 * Finer categories (from the built-in rules, profiles made from the original
 * spending analysis, and the earlier seven buckets) and the bucket each rolls into.
 */
const CATEGORY_ALIASES: Record<string, Assignment> = {
  eating_out: "food",
  groceries: "food",
  subscriptions: "bills",
  housing: "bills",
  shopping: "others",
  just_because: "others",
  essentials: "others",
  transport: "others",
  personal: "others",
  personal_care: "others",
  health: "others",
  home: "others",
  fees: "others",
  other: "others",
};

export function toAssignment(category: string | undefined | null): Assignment | undefined {
  if (!category) return undefined;
  if (BUCKET_IDS.has(category)) return category as Bucket;
  if (category === "transfer" || category === "ignore") return category;
  return CATEGORY_ALIASES[category];
}

export type TxnKind = "spend" | "income" | "transfer" | "supplementary";

export type Txn = {
  id: string;
  source: string; // amex | nab | commbank | other
  date: string; // YYYY-MM-DD
  description: string;
  /** Positive = money out (a purchase); negative = money in (refund, credit, income). */
  amount: number;
  cardholder?: string;
  kind: TxnKind;
  /** Captured from a phone notification: shown at once, replaced when the statement row for it arrives. */
  provisional?: boolean;
  /** When it happened (ISO time), for phone-captured transactions. */
  at?: string;
  /** The phone app that reported it ("Google Wallet", "Amex app", …). */
  via?: string;
  /** A regular charge counted on its usual day because nothing reported it (see expectedCharges). */
  expected?: boolean;
  /** For expected charges: the bucket or category it counts against. */
  category?: string;
};

/**
 * A charge that comes every month but sends no notification (e.g. a
 * subscription on a card): counted on its usual day until a real row for it
 * turns up. `match` is the normalised statement description that confirms it.
 */
/** An amount as of the end of a day. */
export type Anchor = { amount: number; asOf: string };
/**
 * A card as the banking app shows it on `asOf`: `amount` = everything owed (incl. pending), `statement` =
 * the latest statement's balance still unpaid, `due` = its due date. `closeDay` (day of month the statement
 * closes) and the 14-day payment window predict the next statement.
 */
export type CardAnchor = Anchor & { statement?: number; due?: string; closeDay?: number };

export const CARD_DEFAULTS: Record<string, { closeDay: number }> = { nab: { closeDay: 16 }, amex: { closeDay: 1 } };
/** Days from a statement closing to its due date (both cards: about 30-day statements, 14 days to pay). */
export const PAYMENT_WINDOW_DAYS = 14;

export type CashAnchors = {
  /** All the cash on hand (accounts and cash), as one total. */
  bank?: Anchor;
  /** Where that total came from, so it's quick to update next time. */
  pockets?: { name: string; amount: number }[];
  /** Each card ("amex", "nab"): total owed, what's still to pay on the latest statement, and when that's due. */
  cards?: Record<string, CardAnchor>;
  /** Money others owe you (e.g. supplementary cardholders paying you back). */
  owedToYou?: number;
};

export type Recurring = { id: string; name: string; amount: number; day: number; category: string; match?: string };

/**
 * A debt repaid from pay. Repayments are optional: `payment` is the usual
 * amount, and each month the owner logs what they actually paid (0 = skipped).
 * `balance` is what was owed when the debt was added; the log is subtracted.
 */
export type Debt = {
  name: string;
  balance: number;
  payment: number;
  log?: { period: string; amount: number }[];
};

export const debtRemaining = (d: Debt) =>
  Math.max(0, d.balance - (d.log ?? []).reduce((a, x) => a + x.amount, 0));

/** What was logged for this pay period (0 = skipped), or undefined if not decided yet. */
export const debtLogged = (d: Debt, period: Period) => d.log?.find((x) => x.period === (period.key ?? period.start))?.amount;

/** Repayments counted against a month: what was logged, else the planned amount. */
export function debtsForPeriod(profile: Profile, period: Period) {
  return profile.debts.reduce((a, d) => {
    const logged = debtLogged(d, period);
    if (logged !== undefined) return a + logged;
    const left = debtRemaining(d);
    return a + (left > 0 ? Math.min(d.payment, left) : 0);
  }, 0);
}

/** Record (or with amount === null, clear) what was paid on a debt this period. */
export function logDebt(d: Debt, period: Period, amount: number | null): Debt {
  const key = period.key ?? period.start;
  const log = (d.log ?? []).filter((x) => x.period !== key);
  if (amount !== null) log.push({ period: key, amount: Math.max(0, amount) });
  return { ...d, log };
}

export type Profile = {
  /** Day of month pay lands; budget periods run from this day to the day before. */
  payday: number;
  payAmount?: number;
  /** Set aside on payday before any spending ("pay yourself first"). */
  savingsTarget?: number;
  /** Savings already put away (the starting point for the projection). */
  startingSavings?: number;
  /** One month of spending held in reserve, so each month is paid from the
   * previous month's pay. Defaults to the sum of the allowances. */
  bufferTarget?: number;
  /** Emergency fund on top of the buffer. Defaults to 3 months of allowances. */
  emergencyTarget?: number;
  /** Savings account interest, % per year (optional). */
  interestRate?: number;
  /** Track from this date (YYYY-MM-DD): earlier transactions are deleted and never imported. */
  startDate?: string;
  /** Money owed, repaid from pay each month (paid outside the budget buckets). */
  debts: Debt[];
  /** Regular charges that send no notification. */
  recurring: Recurring[];
  /** Balances the owner entered, as of a date; the cash position adds what happened since (see cashPosition). */
  cash?: CashAnchors;
  /** Cardholder names whose spending counts as the owner's own. */
  ownCardholders: string[];
  /** If non-empty, rows for any other cardholder are dropped at import. */
  allowedCardholders: string[];
  targets: Partial<Record<Bucket, number>>;
  /** normaliseDescription(description) -> category/bucket. */
  rules: Record<string, string>;
};

export const EMPTY_PROFILE: Profile = {
  payday: 15,
  ownCardholders: [],
  allowedCardholders: [],
  targets: {},
  rules: {},
  debts: [],
  recurring: [],
};

/** Uppercase, drop digit runs and punctuation, so store numbers and receipt
 * prefixes don't stop a merchant from matching its rule. */
export function normaliseDescription(d: string): string {
  return d
    .toUpperCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^A-Z&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Generic Australian chains and merchant types only (see PRIVACY note above).
// Order matters: the first match wins.
const BUILTIN_RULES: [RegExp, string][] = [
  [/ANNUAL FEE|INTNL TRAN FEE|INTERNATIONAL TRANSACTION FEE|LATE (PAYMENT )?FEE|INTEREST CHARGE|CASH ADVANCE FEE/, "fees"],
  [/NETFLIX|SPOTIFY|DISNEY|\bSTAN\b|BINGE|YOUTUBE|APPLE\.COM\/BILL|AMAZON ?PRIME|AMZNPRIME|PRIME VIDEO|SOUNDCLOUD|TIDAL|STRAVA|UBER ?ONE|OPENAI|CHATGPT|FITNESS|\bGYM\b|SNAP FITNE/, "subscriptions"],
  [/UBER ?\*? ?EATS|DOORDASH|MENULOG|MCDONALD|\bKFC\b|HUNGRY JACK|GUZMAN|NANDO|DOMINO|PIZZA|SUBWAY|GRILL'D|STARBUCKS|GLORIA JEAN|BOOST JUICE|\bCAFE\b|COFFEE|ESPRESSO|BAKERY|BAKEHOUSE|RESTAURANT|SUSHI|RAMEN|DUMPLING|BURGER/, "eating_out"],
  [/WOOLWORTHS|\bCOLES\b|\bALDI\b|\bIGA\b|HARRIS FARM|FOODWORKS|COSTCO|DAN MURPHY|\bBWS\b|LIQUORLAND|BUTCHER|GROCER/, "groceries"],
  [/QANTAS|VIRGIN AUSTRALIA|JETSTAR|AIRASIA|CATHAY|SINGAPORE AIRLINES|EMIRATES|AIRBNB|BOOKING\.COM|EXPEDIA|AGODA|HOTEL|MOTEL|KLOOK|AMEX TRAVEL|HERTZ|\bAVIS\b|THRIFTY|EUROPCAR|\bTURO\b/, "travel"],
  [/CHARGEFOX|\bEVIE\b|SUPERCHARG|AMPOL|\bBP\b|\bSHELL\b|CALTEX|LINKT|CITYLINK|EASTLINK|\bMYKI\b|\bPTV\b|\bUBER\b|DIDI|13CABS|PARKING|ORIKAN|PAYSTAY|GOGET|CAR ?WASH/, "transport"],
  [/TELSTRA|OPTUS|VODAFONE|\bTPG\b|AUSSIE BROADBAND|LAUNTEL|YOODO|GLOBIRD|AGL|ORIGIN ENERGY|ENERGYAUSTRALIA|LUMO|1ST ENERGY|RED ENERGY|ALINTA|SIMPLY ENERGY|WATER|COUNCIL|VICROADS|INSURANCE|MEDIBANK|\bBUPA\b|\bNIB\b|\bHCF\b|\bAAMI\b|\bRACV\b|BUDGET DIRECT|\bYOUI\b/, "bills"],
  [/\bRENT\b|MORTGAGE|REAL ESTATE|STRATA|BODY CORP/, "housing"],
  [/FLORIST|FLOWER|MICHAEL HILL|PANDORA|PROUDS|LINDT|KOKO BLACK|\bGIFT/, "just_because"],
  [/HOYTS|CINEMA|TICKETEK|TICKETMASTER|MOSHTIX|OZTIX|ESCAPE|BOWL|KINGPIN|\bSTRIKE\b|TIMEZONE|LUNA PARK|STEAMGAMES|PLAYSTATION|NINTENDO|XBOX/, "entertainment"],
  [/CHEMIST|PHARMACY|PRICELINE|MEDICAL|DENTAL|PHYSIO|BARBER|\bHAIR|SALON|MASSAGE|\bSPA\b|SEPHORA|MECCA|BUNNINGS|\bIKEA\b|HARDWARE/, "personal"],
  [/AMAZON|AMZN|KMART|\bTARGET\b|BIG W|JB HI|HARVEY NORMAN|OFFICEWORKS|\bMYER\b|DAVID JONES|UNIQLO|EBAY|TEMU|SHEIN|\bREBEL\b/, "shopping"],
];

export function categorise(
  txn: Pick<Txn, "description">,
  profile: Profile,
  overrides: Record<string, string>,
): Assignment | "uncategorised" {
  const key = normaliseDescription(txn.description);
  const fromOverride = toAssignment(overrides[key]);
  if (fromOverride) return fromOverride;
  const fromProfile = toAssignment(profile.rules[key]);
  if (fromProfile) return fromProfile;
  const upper = txn.description.toUpperCase();
  // A listed regular charge carries its own category.
  for (const r of profile.recurring ?? []) {
    if (r.match && upper.includes(r.match.toUpperCase())) {
      const fromRecurring = toAssignment(r.category);
      if (fromRecurring) return fromRecurring;
    }
  }
  for (const [re, category] of BUILTIN_RULES) if (re.test(upper)) return toAssignment(category) ?? "uncategorised";
  return "uncategorised";
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Australian (day-first) dates: 2026-09-14, 14/09/2026, 14/9/26, 14 Sep 26, 14-Sep-2026. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${fullYear(+m[3])}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${fullYear(+m[3])}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(+m[1])}`;
  return null;
}

/** "$1,234.50", "-12.00", "(12.00)", "12.00 CR" -> number (credit/parentheses negative). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  let neg = false;
  if (s.endsWith("CR")) {
    neg = true;
    s = s.slice(0, -2);
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -Math.abs(n) : n;
}

export type ColumnMapping = {
  source: string;
  hasHeader: boolean;
  date: number;
  description: number;
  amount: number;
  /** "negative": purchases are negative numbers (bank exports); "positive": purchases are positive (Amex). */
  spendSign: "negative" | "positive";
  cardholder?: number;
};

const findCol = (header: string[], ...names: string[]) =>
  header.findIndex((h) => names.includes(h.trim().toLowerCase()));

/**
 * Best-effort detection of the common export layouts. Bank export formats
 * change without notice, so anything unrecognised falls back to the manual
 * column mapping in the UI rather than guessing.
 */
export function detectMapping(rows: string[][]): ColumnMapping | "parsed" | null {
  if (!rows.length) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header.includes("amount_aud") && header.includes("description") && header.includes("kind")) return "parsed";

  // Amex Online export: Date, [Date Processed,] Description, Card Member, Account #, Amount
  if (header.includes("card member") && header.includes("amount")) {
    return {
      source: "amex",
      hasHeader: true,
      date: findCol(header, "date"),
      description: findCol(header, "description"),
      amount: findCol(header, "amount"),
      cardholder: findCol(header, "card member"),
      spendSign: "positive",
    };
  }
  // NAB Internet Banking export with header row.
  if (header.includes("transaction details") && header.includes("amount")) {
    const merchant = findCol(header, "merchant name");
    return {
      source: "nab",
      hasHeader: true,
      date: findCol(header, "date"),
      description: merchant >= 0 ? merchant : findCol(header, "transaction details"),
      amount: findCol(header, "amount"),
      spendSign: "negative",
    };
  }
  // CommBank NetBank export: no header; Date, Amount, Description, Balance.
  const r = rows[0];
  if (r.length >= 3 && r.length <= 5 && parseDate(r[0]) && parseAmount(r[1]) !== null && parseAmount(r[2]) === null) {
    return { source: "commbank", hasHeader: false, date: 0, amount: 1, description: 2, spendSign: "negative" };
  }
  return null;
}

const CARD_SOURCES = new Set(["amex", "nab"]);

function classify(source: string, description: string, amount: number): TxnKind {
  const d = description.toUpperCase();
  if (CARD_SOURCES.has(source)) {
    // Card statement: payments to the card are transfers, not income.
    if (amount < 0 && /PAYMENT|THANK ?YOU|DIRECT DEBIT/.test(d)) return "transfer";
    return "spend";
  }
  // Bank account: card repayments and moves between own accounts are transfers.
  if (/TRANSFER|AMERICAN EXPRESS|\bAMEX\b|NAB CARDS?|CREDIT CARD|BPAY.*(AMEX|NAB|CARD)/.test(d)) return "transfer";
  return amount < 0 ? "income" : "spend";
}

/** Stable id so re-importing an overlapping export doesn't double count. The
 * occurrence counter keeps genuinely repeated same-day purchases distinct. */
function makeIds<T extends Omit<Txn, "id">>(rows: T[]): (T & { id: string })[] {
  const seen = new Map<string, number>();
  return rows.map((t) => {
    const base = `${t.source}|${t.date}|${t.amount.toFixed(2)}|${normaliseDescription(t.description)}|${t.cardholder ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...t, id: `${base}|${n}` };
  });
}

function cardholderAllowed(holder: string | undefined, profile: Profile) {
  if (!holder || !profile.allowedCardholders.length) return true;
  return profile.allowedCardholders.some((h) => h.toUpperCase() === holder.toUpperCase());
}

function kindForHolder(kind: TxnKind, holder: string | undefined, profile: Profile): TxnKind {
  if (kind !== "spend" || !holder || !profile.ownCardholders.length) return kind;
  const own = profile.ownCardholders.some((h) => h.toUpperCase() === holder.toUpperCase());
  return own ? kind : "supplementary";
}

/** The analysis CSV (source,statement_closing,cycle,date,cardholder,kind,description,detail,amount_aud). */
function fromParsedCsv(rows: string[][], profile: Profile): Txn[] {
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = (n: string) => h.indexOf(n);
  const out: Omit<Txn, "id">[] = [];
  for (const r of rows.slice(1)) {
    const date = parseDate(r[col("date")] ?? "");
    const amount = parseAmount(r[col("amount_aud")] ?? "");
    if (!date || amount === null) continue;
    const holder = r[col("cardholder")]?.trim() || undefined;
    const rowKind = r[col("kind")]?.trim();
    // Pseudo-holders: PAYMENT rows are card repayments/benefit credits; ACCOUNT rows are account-level credits.
    const realHolder = holder === "PAYMENT" || holder === "ACCOUNT" ? undefined : holder;
    if (!cardholderAllowed(realHolder, profile)) continue;
    const kind: TxnKind = rowKind === "payment" ? "transfer" : kindForHolder("spend", realHolder, profile);
    out.push({
      source: r[col("source")]?.trim() || "other",
      date,
      description: r[col("description")] ?? "",
      amount,
      cardholder: holder,
      kind,
    });
  }
  return makeIds(out);
}

export function fromMappedCsv(rows: string[][], m: ColumnMapping, profile: Profile): Txn[] {
  const out: Omit<Txn, "id">[] = [];
  for (const r of m.hasHeader ? rows.slice(1) : rows) {
    const date = parseDate(r[m.date] ?? "");
    const raw = parseAmount(r[m.amount] ?? "");
    if (!date || raw === null || raw === 0) continue;
    const amount = m.spendSign === "negative" ? -raw : raw;
    const description = (r[m.description] ?? "").trim();
    const holder = m.cardholder !== undefined && m.cardholder >= 0 ? r[m.cardholder]?.trim() || undefined : undefined;
    if (!cardholderAllowed(holder, profile)) continue;
    const kind = kindForHolder(classify(m.source, description, amount), holder, profile);
    out.push({ source: m.source, date, description, amount, cardholder: holder, kind });
  }
  return makeIds(out);
}

export type ImportResult =
  | { ok: true; txns: Txn[]; format: string }
  | { ok: false; needsMapping: true; rows: string[][] }
  | { ok: false; needsMapping: false; error: string };

export function importCsv(text: string, profile: Profile): ImportResult {
  const rows = parseCsv(text);
  if (!rows.length) return { ok: false, needsMapping: false, error: "The file is empty." };
  const detected = detectMapping(rows);
  if (detected === "parsed") return { ok: true, txns: fromParsedCsv(rows, profile), format: "analysis CSV" };
  if (!detected) return { ok: false, needsMapping: true, rows };
  return { ok: true, txns: fromMappedCsv(rows, detected, profile), format: detected.source };
}

/** Debts are matched by name when two devices' edits are merged, so a repeated name gets " (2)", " (3)"… */
function uniqueNames(debts: Debt[]): Debt[] {
  const seen = new Set<string>();
  return debts.map((d) => {
    let name = d.name;
    for (let n = 2; seen.has(name); n++) name = `${d.name} (${n})`;
    seen.add(name);
    return name === d.name ? d : { ...d, name };
  });
}

/** False for a transaction before the profile's "track from" date. */
export const tracked = (t: Pick<Txn, "date">, profile: Pick<Profile, "startDate">) =>
  !profile.startDate || t.date >= profile.startDate;

/** Adds new transactions, skipping ids already stored. Returns the merged list and how many were new. */
export function mergeTxns(existing: Txn[], incoming: Txn[]): { txns: Txn[]; added: number } {
  const ids = new Set(existing.map((t) => t.id));
  const fresh = incoming.filter((t) => !ids.has(t.id));
  const txns = [...existing, ...fresh].sort((a, b) => b.date.localeCompare(a.date));
  return { txns, added: fresh.length };
}

// ---------------------------------------------------------------------------
// Budget periods (pay cycle)
// ---------------------------------------------------------------------------

/** Inclusive, YYYY-MM-DD. `key` is the nominal payday start (debt logs are kept against it). */
export type Period = { start: string; end: string; key?: string };

const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

/** Payday clamped to the month's length (a 31st payday becomes the 30th in April). */
function paydayIn(year: number, month0: number, payday: number) {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month0, Math.min(payday, last)));
}

export function periodFor(date: string, payday: number): Period {
  const d = utc(date);
  let start = paydayIn(d.getUTCFullYear(), d.getUTCMonth(), payday);
  if (start > d) start = paydayIn(d.getUTCFullYear(), d.getUTCMonth() - 1, payday);
  const next = paydayIn(start.getUTCFullYear(), start.getUTCMonth() + 1, payday);
  const end = new Date(next.getTime() - 86400000);
  return { start: iso(start), end: iso(end) };
}

export function shiftPeriod(p: Period, by: number, payday: number): Period {
  const s = utc(p.start);
  const target = paydayIn(s.getUTCFullYear(), s.getUTCMonth() + by, payday);
  return periodFor(iso(target), payday);
}

export function periodProgress(p: Period, today: string): number {
  if (today < p.start) return 0;
  if (today > p.end) return 1;
  const total = (utc(p.end).getTime() - utc(p.start).getTime()) / 86400000 + 1;
  const done = (utc(today).getTime() - utc(p.start).getTime()) / 86400000 + 1;
  return done / total;
}

export type PeriodSummary = {
  byBucket: Record<string, number>; // includes "uncategorised"
  spent: number;
  income: number;
  /** Spending on supplementary cards: not in the budget (paid back), shown separately. */
  supplementary: number;
  supplementaryBy: Record<string, number>;
  txns: (Txn & { assignment: Assignment | "uncategorised" })[];
};

/** With `today`, regular charges due by then that nothing reported are counted too (see expectedCharges). */
export function summarise(
  txns: Txn[],
  period: Period,
  profile: Profile,
  overrides: Record<string, string>,
  today?: string,
): PeriodSummary {
  const byBucket: Record<string, number> = {};
  let spent = 0;
  let income = 0;
  let supplementary = 0;
  const supplementaryBy: Record<string, number> = {};
  const rows: PeriodSummary["txns"] = [];
  const all = today ? [...txns, ...expectedCharges(txns, period, profile, today)] : txns;
  for (const t of all) {
    if (t.date < period.start || t.date > period.end) continue;
    const assignment =
      t.kind !== "spend" ? t.kind : t.expected ? (toAssignment(t.category) ?? "uncategorised") : categorise(t, profile, overrides);
    rows.push({ ...t, assignment: assignment as Assignment | "uncategorised" });
    if (t.kind === "income") income += -t.amount;
    else if (t.kind === "supplementary") {
      supplementary += t.amount;
      const who = t.cardholder || "Supplementary card";
      supplementaryBy[who] = (supplementaryBy[who] ?? 0) + t.amount;
    }
    else if (t.kind === "spend" && assignment !== "transfer" && assignment !== "ignore") {
      byBucket[assignment] = (byBucket[assignment] ?? 0) + t.amount;
      spent += t.amount;
    }
  }
  return { byBucket, spent, income, supplementary, supplementaryBy, txns: rows };
}

// ---------------------------------------------------------------------------
// Pay periods that start when pay actually lands
// ---------------------------------------------------------------------------

/** How far from the usual payday a salary can land and still start that period (early before a weekend, late after a holiday). */
const PAY_WINDOW_DAYS = 6;

/** The days salary landed: money-in rows at least half the usual pay (or $500 if pay isn't set). */
export function payDates(txns: Txn[], profile: Profile): string[] {
  const min = Math.max(500, (profile.payAmount ?? 0) * 0.5);
  return [...new Set(txns.filter((t) => t.kind === "income" && -t.amount >= min).map((t) => t.date))].sort();
}

const between = (a: string, b: string) => Math.round((utc(a).getTime() - utc(b).getTime()) / 86_400_000);

/** When the period that nominally starts on `nominal` really starts: the day pay landed near it, else the payday. */
function actualStart(nominal: string, pays: string[]) {
  return pays.find((d) => Math.abs(between(d, nominal)) <= PAY_WINDOW_DAYS) ?? nominal;
}

/**
 * The pay period containing `date`: from the day pay landed (or the payday, if no pay is recorded near it)
 * to the day before the next one. So buckets reset when the money actually arrives.
 */
export function payPeriodFor(date: string, profile: Profile, pays: string[]): Period {
  const base = periodFor(date, profile.payday);
  for (const k of [0, 1, -1]) {
    const nom = k === 0 ? base : shiftPeriod(base, k, profile.payday);
    const start = actualStart(nom.start, pays);
    const next = shiftPeriod(nom, 1, profile.payday);
    const end = iso(new Date(utc(actualStart(next.start, pays)).getTime() - 86_400_000));
    if (date >= start && date <= end) return { start, end, key: nom.start };
  }
  return { ...base, key: base.start };
}

export function shiftPayPeriod(p: Period, by: number, profile: Profile, pays: string[]): Period {
  const nominal = periodFor(p.key ?? p.start, profile.payday);
  const target = shiftPeriod(nominal, by, profile.payday);
  // Day 10 of a nominal period is always inside the real one (pay moves it by at most 6 days).
  return payPeriodFor(iso(new Date(utc(target.start).getTime() + 10 * 86_400_000)), profile, pays);
}

/** Short merchant name for grouping: the normalised description minus
 * card-processor prefixes and trailing location words beyond the first few. */
export function merchantKey(description: string): string {
  const n = normaliseDescription(description)
    .replace(/^(SQ|SP|ZLR|LS|PIN|PAYPAL|GOOGLE|IZ|TST)\b\s*/, "")
    .replace(/\b(PTY|LTD|P\/L)\b/g, "")
    .trim();
  return n.split(" ").slice(0, 3).join(" ") || description;
}

export type MerchantTotal = { merchant: string; amount: number; count: number };

/** Where the money went in one bucket: merchants by net spend, largest first. */
export function topMerchants(rows: PeriodSummary["txns"], bucket: string, limit = 5): MerchantTotal[] {
  const m = new Map<string, MerchantTotal>();
  for (const t of rows) {
    if (t.kind !== "spend" || t.assignment !== bucket) continue;
    const k = merchantKey(t.description);
    const e = m.get(k) ?? { merchant: k, amount: 0, count: 0 };
    e.amount += t.amount;
    e.count += 1;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/**
 * The monthly plan: pay in, savings out first, debt repayments, then each
 * bucket's allowance. Whatever is left is unallocated — it must cover anything
 * not budgeted (e.g. bills paid from the bank account) or it should go to savings.
 */
export function planFor(profile: Profile) {
  const allowances = Object.values(profile.targets).reduce((a, b) => a + (b ?? 0), 0);
  const savings = profile.savingsTarget ?? 0;
  const pay = profile.payAmount ?? 0;
  const debts = profile.debts.reduce((a, d) => a + Math.min(d.payment, debtRemaining(d)), 0);
  return { pay, savings, debts, allowances, unallocated: pay - savings - debts - allowances };
}

/** Payments left on a debt and the size of the final one. */
export function debtPayoff(d: Debt) {
  const left = debtRemaining(d);
  if (left <= 0) return { payments: 0, last: 0 };
  if (d.payment <= 0) return { payments: Infinity, last: 0 };
  const payments = Math.ceil(left / d.payment - 1e-9);
  return { payments, last: left - (payments - 1) * d.payment };
}

/** Latest transaction date seen per source — how fresh the "live" view is. */
export function freshness(txns: Txn[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of txns) if (!out[t.source] || t.date > out[t.source]) out[t.source] = t.date;
  return out;
}

const nonNegative = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function normaliseProfile(raw: unknown): Profile {
  const p = (raw ?? {}) as Partial<Profile>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const targets: Profile["targets"] = {};
  for (const [k, v] of Object.entries(p.targets ?? {})) {
    if (BUCKET_IDS.has(k) && typeof v === "number" && v >= 0) targets[k as Bucket] = v;
  }
  const rules: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.rules ?? {})) if (typeof v === "string") rules[normaliseDescription(k)] = v;
  const payday = typeof p.payday === "number" && p.payday >= 1 && p.payday <= 31 ? Math.floor(p.payday) : 15;
  return {
    payday,
    payAmount: typeof p.payAmount === "number" ? p.payAmount : undefined,
    savingsTarget: nonNegative(p.savingsTarget),
    startingSavings: nonNegative(p.startingSavings),
    bufferTarget: nonNegative(p.bufferTarget),
    emergencyTarget: nonNegative(p.emergencyTarget),
    interestRate: nonNegative(p.interestRate),
    startDate: typeof p.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.startDate) ? p.startDate : undefined,
    cash: normaliseCash(p.cash),
    recurring: Array.isArray(p.recurring)
      ? p.recurring
          .filter(
            (r): r is Recurring =>
              !!r && typeof r.id === "string" && typeof r.name === "string" && typeof r.amount === "number" &&
              typeof r.day === "number" && typeof r.category === "string",
          )
          .map((r) => ({
            id: r.id,
            name: r.name,
            amount: Math.max(0, r.amount),
            day: Math.min(31, Math.max(1, Math.round(r.day))),
            category: r.category,
            ...(typeof r.match === "string" && r.match ? { match: r.match } : {}),
          }))
      : [],
    debts: uniqueNames(
      Array.isArray(p.debts)
        ? p.debts
            .filter((d): d is Debt => !!d && typeof d.name === "string" && typeof d.balance === "number" && typeof d.payment === "number")
            .map((d) => ({
              name: d.name,
              balance: Math.max(0, d.balance),
              payment: Math.max(0, d.payment),
              log: Array.isArray(d.log)
                ? d.log.filter((x) => x && typeof x.period === "string" && typeof x.amount === "number")
                : [],
            }))
        : [],
    ),
    ownCardholders: strings(p.ownCardholders),
    allowedCardholders: strings(p.allowedCardholders),
    targets,
    rules,
  };
}

// ---------------------------------------------------------------------------
// Savings: the one-month buffer and the projection
// ---------------------------------------------------------------------------

/** Buffer and emergency-fund goals, with defaults derived from the plan. */
export function savingsGoals(profile: Profile) {
  const { allowances } = planFor(profile);
  const buffer = profile.bufferTarget ?? Math.ceil(allowances / 100) * 100;
  const emergency = profile.emergencyTarget ?? Math.ceil((allowances * 3) / 100) * 100;
  return { buffer, emergency };
}

export type ProjectionPoint = {
  month: number;
  balance: number;
  contributed: number;
  interest: number;
  /** Total still owed across all debts after this month's repayments. */
  debt: number;
};

/**
 * Month-by-month savings balance if the same amount goes in every payday.
 * Debts are repaid alongside; with `rollover`, a debt's repayment moves into
 * savings from the month after it is paid off. Interest compounds monthly.
 */
export function project(opts: {
  start: number;
  monthly: number;
  months: number;
  annualRate?: number;
  buffer: number;
  emergency: number;
  debts?: Debt[];
  rollover?: boolean;
}) {
  const r = (opts.annualRate ?? 0) / 100 / 12;
  const owed = (opts.debts ?? []).map((d) => ({ balance: debtRemaining(d), payment: d.payment }));
  const totalOwed = () => owed.reduce((a, d) => a + d.balance, 0);
  const points: ProjectionPoint[] = [{ month: 0, balance: opts.start, contributed: 0, interest: 0, debt: totalOwed() }];
  let balance = opts.start;
  let contributed = 0;
  let interest = 0;
  let freed = 0; // repayments already finished and redirected into savings
  let debtFreeMonth: number | null = totalOwed() > 0 ? null : 0;
  for (let m = 1; m <= opts.months; m++) {
    const i = balance > 0 ? balance * r : 0;
    interest += i;
    const deposit = opts.monthly + (opts.rollover ? freed : 0);
    contributed += deposit;
    balance += i + deposit;
    for (const d of owed) {
      if (d.balance <= 0) continue;
      d.balance = Math.max(0, d.balance - d.payment);
      if (d.balance === 0) freed += d.payment;
    }
    if (debtFreeMonth === null && totalOwed() <= 0) debtFreeMonth = m;
    points.push({ month: m, balance, contributed, interest, debt: totalOwed() });
  }
  const reach = (target: number) => (target <= 0 ? null : points.find((p) => p.balance >= target)?.month ?? null);
  return { points, bufferMonth: reach(opts.buffer), emergencyMonth: reach(opts.buffer + opts.emergency), debtFreeMonth };
}

/**
 * What has actually been left over (pay − debt repayments − spent) on average over the last
 * `n` finished pay periods — "if nothing changes" for the projection.
 */
// ---------------------------------------------------------------------------
// Regular charges that send no notification
// ---------------------------------------------------------------------------

const addDays = (date: string, n: number) => iso(new Date(utc(date).getTime() + n * 86_400_000));

/** The date in `period` on day `day` of a month (a short month uses its last day), or null. */
export function dayInPeriod(period: Period, day: number): string | null {
  const s = utc(period.start);
  for (const m of [0, 1]) {
    const y = s.getUTCFullYear();
    const mo = s.getUTCMonth() + m;
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const d = iso(new Date(Date.UTC(y, mo, Math.min(day, last))));
    if (d >= period.start && d <= period.end) return d;
  }
  return null;
}

/** Whether a real row (or a phone-captured one) accounts for a regular charge due on `date`. */
function chargeSeen(r: Recurring, date: string, txns: Txn[]) {
  const lo = addDays(date, -7);
  const hi = addDays(date, 7);
  const tolerance = Math.max(1, r.amount * 0.1);
  return txns.some(
    (t) =>
      !t.expected &&
      t.date >= lo &&
      t.date <= hi &&
      Math.abs(t.amount - r.amount) <= tolerance &&
      (!r.match || t.provisional || normaliseDescription(t.description).includes(r.match)),
  );
}

/** Regular charges due in `period` by `today` that no real row accounts for yet, as stand-in rows. */
export function expectedCharges(txns: Txn[], period: Period, profile: Profile, today: string): Txn[] {
  const out: Txn[] = [];
  for (const r of profile.recurring ?? []) {
    const date = dayInPeriod(period, r.day);
    if (!date || date > today || !tracked({ date }, profile) || chargeSeen(r, date, txns)) continue;
    out.push({
      id: `expected|${r.id}|${date}`,
      source: "expected",
      date,
      description: r.name,
      amount: r.amount,
      kind: "spend",
      expected: true,
      category: r.category,
    });
  }
  return out;
}

/** Regular charges still to come in `period` after `today`. */
export function upcomingCharges(period: Period, profile: Profile, today: string) {
  return (profile.recurring ?? [])
    .map((r) => ({ r, date: dayInPeriod(period, r.day) }))
    .filter((x): x is { r: Recurring; date: string } => !!x.date && x.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Likely regular charges in the history: the same description in 3+ months,
 * about once a month, at a steady amount (within 10%), not already listed.
 */
export function suggestRecurring(txns: Txn[], profile: Profile, overrides: Record<string, string>) {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.kind !== "spend" || t.provisional || t.expected || t.amount <= 0) continue;
    const k = normaliseDescription(t.description);
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }
  const listed = new Set((profile.recurring ?? []).map((r) => r.match).filter(Boolean));
  const out: Omit<Recurring, "id">[] = [];
  for (const [k, list] of groups) {
    if (listed.has(k)) continue;
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 3 || list.length > months.size + 1) continue;
    const amounts = list.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (amounts.some((a) => Math.abs(a - median) > Math.max(1, median * 0.1))) continue;
    const assignment = categorise(list[0], profile, overrides);
    if (assignment === "transfer" || assignment === "ignore") continue;
    const days = list.map((t) => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    out.push({
      name: merchantKey(list[0].description),
      amount: Math.round(median * 100) / 100,
      day: days[Math.floor(days.length / 2)],
      category: assignment === "uncategorised" ? "bills" : assignment,
      match: k,
    });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 12);
}

export function recentPace(
  txns: Txn[],
  profile: Profile,
  overrides: Record<string, string>,
  today: string,
  n = 3,
) {
  const current = periodFor(today, profile.payday);
  const pay = profile.payAmount ?? 0;
  const results: number[] = [];
  for (let i = 1; i <= n; i++) {
    const p = shiftPeriod(current, -i, profile.payday);
    const s = summarise(txns, p, profile, overrides, today);
    if (!s.txns.length) continue;
    results.push((s.income > 0 ? s.income : pay) - planFor(profile).debts - s.spent);
  }
  return results.length ? results.reduce((a, b) => a + b, 0) / results.length : null;
}

// ---------------------------------------------------------------------------
// Cash position: what's in the bank vs what's owed on the cards
// ---------------------------------------------------------------------------

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const anchorOf = (v: unknown): Anchor | undefined => {
  const a = v as Anchor;
  return a && typeof a.amount === "number" && Number.isFinite(a.amount) && isDay(a.asOf) ? { amount: a.amount, asOf: a.asOf } : undefined;
};

function normaliseCash(raw: unknown): CashAnchors | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as CashAnchors;
  const cards: NonNullable<CashAnchors["cards"]> = {};
  for (const [k, v] of Object.entries(c.cards ?? {})) {
    const a = anchorOf(v);
    if (!a) continue;
    const x = v as CardAnchor;
    cards[k] = {
      ...a,
      ...(typeof x.statement === "number" && x.statement >= 0 ? { statement: x.statement } : {}),
      ...(isDay(x.due) ? { due: x.due } : {}),
      ...(typeof x.closeDay === "number" && x.closeDay >= 1 && x.closeDay <= 31 ? { closeDay: Math.round(x.closeDay) } : {}),
    };
  }
  return {
    ...(anchorOf(c.bank) ? { bank: anchorOf(c.bank) } : {}),
    ...(Array.isArray(c.pockets)
      ? {
          pockets: c.pockets
            .filter((x) => x && typeof x.name === "string" && typeof x.amount === "number" && Number.isFinite(x.amount))
            .map((x) => ({ name: x.name.slice(0, 60), amount: x.amount })),
        }
      : {}),
    cards,
    ...(typeof c.owedToYou === "number" && c.owedToYou > 0 ? { owedToYou: c.owedToYou } : {}),
  };
}

export const CARD_LABELS: Record<string, string> = { amex: "Amex", nab: "NAB" };
const CARD_WORDS: Record<string, RegExp> = { nab: /\bNAB\b/i, amex: /AMERICAN EXPRESS|\bAMEX\b/i };

/** The statement closing on day `day` of the month, on or before `date` (short months use their last day). */
export function closeOnOrBefore(date: string, day: number): string {
  const d = utc(date);
  for (const m of [0, -1]) {
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + m;
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const c = iso(new Date(Date.UTC(y, mo, Math.min(day, last))));
    if (c <= date) return c;
  }
  return date;
}
const nextClose = (close: string, day: number) => closeOnOrBefore(addDays(close, 40), day);

export type CardPosition = {
  source: string;
  owed: number; // everything owed now
  statement: number; // latest statement still to pay (0 = paid)
  due: string;
  daysLeft: number;
  overdue: boolean;
  next: { amount: number; closes: string; due: string }; // building up for the next statement
  asOf: string;
  added: number;
  repaid: number;
};

export type CashPosition = {
  bank?: { now: number; asOf: string; moved: number };
  cards: CardPosition[];
  owed: number;
  /** bank − everything owed: positive = usable, negative = short. */
  net?: number;
  /** Statements still to pay, in due order, with the bank balance left after each (negative = short). */
  dues: { source: string; amount: number; due: string; daysLeft: number; overdue: boolean; bankAfter?: number }[];
  /** Bank minus statements due (what's usable without risking interest). */
  usable?: number;
  owedToYou: number;
};

const daysFrom = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/**
 * Bank and card balances now, from the balances entered on `asOf` plus what's recorded after:
 * card spending (incl. supplementary, fees, phone-captured) adds to what's owed; refunds take it off;
 * repayments (seen on the card, or as a CommBank transfer to it, whichever is larger) pay the statement
 * first. CommBank rows move the bank balance. Paying each statement in full by its due date keeps the
 * card interest-free; anything after the statement closed is due on the next one.
 */
export function cashPosition(txns: Txn[], profile: Profile, today: string): CashPosition {
  const cash = profile.cash ?? {};
  const cards: CardPosition[] = [];
  for (const [source, a] of Object.entries(cash.cards ?? {})) {
    const closeDay = a.closeDay ?? CARD_DEFAULTS[source]?.closeDay ?? 1;
    const firstClose = closeOnOrBefore(a.asOf, closeDay);
    // Statements as of the entered date: the latest one (what's still unpaid on it), then one per closing
    // date since, each holding the spending from the previous close (statement periods never change).
    const statements: { closes: string; due: string; amount: number }[] = [
      { closes: firstClose, due: a.due ?? addDays(firstClose, PAYMENT_WINDOW_DAYS), amount: a.statement ?? a.amount },
    ];
    let open = a.amount - (a.statement ?? a.amount); // spending since the last close, not yet on a statement
    let added = 0;
    let repaidOnCard = 0;
    let repaidFromBank = 0;
    const events: { date: string; spend: number }[] = [];
    for (const t of txns) {
      if (t.date <= a.asOf || t.date > today) continue;
      if (t.source === source) {
        if (t.kind === "transfer") repaidOnCard += Math.abs(t.amount);
        else if (t.kind !== "income") {
          events.push({ date: t.date, spend: t.amount });
          if (t.amount > 0) added += t.amount;
        }
      } else if (t.source === "commbank" && t.kind === "transfer" && t.amount > 0 && CARD_WORDS[source]?.test(t.description)) {
        repaidFromBank += t.amount;
      }
    }
    events.sort((x, y) => x.date.localeCompare(y.date));
    let close = nextClose(firstClose, closeDay);
    let k = 0;
    while (close <= today) {
      while (k < events.length && events[k].date <= close) open += events[k++].spend;
      statements.push({ closes: close, due: addDays(close, PAYMENT_WINDOW_DAYS), amount: Math.max(0, open) });
      open = 0;
      close = nextClose(close, closeDay);
    }
    while (k < events.length) open += events[k++].spend;
    // Repayments pay the oldest statement first; anything beyond comes off the next one.
    let repaid = Math.max(repaidOnCard, repaidFromBank);
    let left = repaid;
    for (const st of statements) {
      const pay = Math.min(left, st.amount);
      st.amount = Math.round((st.amount - pay) * 100) / 100;
      left -= pay;
    }
    open = Math.round((open - left) * 100) / 100;
    repaid = Math.round(repaid * 100) / 100;
    const unpaid = statements.filter((st) => st.amount > 0.005);
    const current = unpaid[0] ?? statements[statements.length - 1];
    const owed = Math.round((statements.reduce((x, st) => x + st.amount, 0) + open) * 100) / 100;
    cards.push({
      source,
      owed,
      statement: Math.round(unpaid.reduce((x, st) => x + st.amount, 0) * 100) / 100,
      due: current.due,
      daysLeft: daysFrom(today, current.due),
      overdue: unpaid.some((st) => st.due < today),
      next: { amount: Math.max(0, open), closes: close, due: addDays(close, PAYMENT_WINDOW_DAYS) },
      asOf: a.asOf,
      added,
      repaid,
    });
  }
  let bank: CashPosition["bank"];
  if (cash.bank) {
    let moved = 0;
    for (const t of txns) if (t.source === "commbank" && t.date > cash.bank.asOf && t.date <= today) moved -= t.amount;
    bank = { now: Math.round((cash.bank.amount + moved) * 100) / 100, asOf: cash.bank.asOf, moved };
  }
  const owed = cards.reduce((s, c) => s + c.owed, 0);
  let running = bank?.now;
  const dues = cards
    .filter((c) => c.statement > 0.005)
    .sort((x, y) => x.due.localeCompare(y.due))
    .map((c) => {
      if (running !== undefined) running -= c.statement;
      return { source: c.source, amount: c.statement, due: c.due, daysLeft: c.daysLeft, overdue: c.overdue, bankAfter: running };
    });
  return {
    bank,
    cards,
    owed,
    net: bank ? bank.now - owed : undefined,
    dues,
    usable: running,
    owedToYou: cash.owedToYou ?? 0,
  };
}
