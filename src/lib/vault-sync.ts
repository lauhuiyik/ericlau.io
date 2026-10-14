/**
 * What the finance vault holds, and how edits are replayed when two devices
 * save at once. Pure functions, no browser APIs.
 *
 * Every edit is recorded as an op. Saving sends the whole (encrypted) state
 * with the version it was based on; if another device saved first, the client
 * fetches the newer state and replays its unsaved ops on top. Ops are
 * idempotent, so replaying one that already landed (a save whose response
 * was lost) changes nothing, and profile ops are three-way merges, so edits
 * to different settings, or to different months of a debt's repayment log,
 * on two devices both survive.
 *
 * Invariant: no transaction before the profile's "track from" date is ever
 * kept. Adding skips them, and setting the date deletes the older ones, in
 * applyOp itself, so every path (imports, legacy copies, replays) obeys it.
 */

import { type Debt, EMPTY_PROFILE, type Profile, type Txn, mergeTxns, normaliseProfile, tracked } from "./finance";

export type VaultData = { profile: Profile; overrides: Record<string, string>; txns: Txn[] };

export type VaultOp =
  | { t: "txns"; add: Txn[] }
  | { t: "assign"; entries: Record<string, string> }
  /** The settings that changed (`patch`), and what they were before (`from`, filled in by minimiseOp). */
  | { t: "profile"; patch: Partial<Profile>; from?: Partial<Profile> };

export const EMPTY_DATA: VaultData = { profile: EMPTY_PROFILE, overrides: {}, txns: [] };

/** What gets encrypted: the data plus a schema tag and when it was saved. */
export type VaultPlaintext = VaultData & { schema: 1; savedAt: string };

export function toPlaintext(d: VaultData, savedAt: string): VaultPlaintext {
  return { schema: 1, savedAt, profile: d.profile, overrides: d.overrides, txns: d.txns };
}

export function fromPlaintext(raw: unknown): VaultData {
  const p = (raw ?? {}) as Partial<VaultPlaintext>;
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.overrides ?? {})) if (typeof v === "string") overrides[k] = v;
  const profile = normaliseProfile(p.profile);
  return {
    profile,
    overrides,
    txns: Array.isArray(p.txns) ? p.txns.filter((t): t is Txn => isTxn(t) && tracked(t, profile)) : [],
  };
}

function isTxn(t: unknown): t is Txn {
  const x = t as Txn;
  return !!x && typeof x.id === "string" && typeof x.date === "string" && typeof x.amount === "number" && typeof x.description === "string";
}

/** JSON with object keys sorted, so equal settings compare equal whatever order their keys were added in. */
const canonical = (v: unknown): string =>
  v === undefined
    ? "undefined"
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Apply the keys that changed between `from` and `to` onto `cur` (a key set to undefined is removed). */
function mergeRecord<V>(cur: Record<string, V>, from: Record<string, V>, to: Record<string, V>): Record<string, V> {
  const out = { ...cur };
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (same(from[k], to[k])) continue;
    if (to[k] === undefined) delete out[k];
    else out[k] = to[k];
  }
  return out;
}

/** Debts by name: additions, removals, balance/payment changes, and repayment-log entries per month. */
function mergeDebts(cur: Debt[], from: Debt[], to: Debt[]): Debt[] {
  const F = new Map(from.map((d) => [d.name, d]));
  const T = new Map(to.map((d) => [d.name, d]));
  let out = cur.filter((d) => !(F.has(d.name) && !T.has(d.name))); // removed (or renamed) here
  for (const t of to) {
    const f = F.get(t.name);
    const i = out.findIndex((d) => d.name === t.name);
    if (!f) {
      // Added (or renamed to this) here.
      out = i === -1 ? [...out, t] : out.map((d, j) => (j === i ? t : d));
      continue;
    }
    if (i === -1) continue; // removed on the other device: leave it removed
    const c = out[i];
    const log = new Map((c.log ?? []).map((x) => [x.period, x.amount]));
    const fl = new Map((f.log ?? []).map((x) => [x.period, x.amount]));
    const tl = new Map((t.log ?? []).map((x) => [x.period, x.amount]));
    for (const p of new Set([...fl.keys(), ...tl.keys()])) {
      if (fl.get(p) === tl.get(p)) continue;
      if (tl.has(p)) log.set(p, tl.get(p)!);
      else log.delete(p);
    }
    out[i] = {
      ...c,
      balance: f.balance !== t.balance ? t.balance : c.balance,
      payment: f.payment !== t.payment ? t.payment : c.payment,
      log: [...log].map(([period, amount]) => ({ period, amount })).sort((a, b) => a.period.localeCompare(b.period)),
    };
  }
  // Keep this device's order (a renamed debt stays where it was); debts only the other device has go last.
  const rank = new Map(to.map((d, i) => [d.name, i]));
  return out.sort((a, b) => (rank.get(a.name) ?? to.length) - (rank.get(b.name) ?? to.length));
}

function mergeProfile(cur: Profile, patch: Partial<Profile>, from?: Partial<Profile>): Profile {
  const out: Profile = { ...cur };
  const set = out as Record<string, unknown>;
  for (const [k, to] of Object.entries(patch)) {
    if (from && k in from) {
      const was = (from as Record<string, unknown>)[k];
      if (k === "debts") {
        out.debts = mergeDebts(cur.debts, (was as Debt[]) ?? [], (to as Debt[]) ?? []);
        continue;
      }
      if (k === "rules" || k === "targets") {
        set[k] = mergeRecord(
          (cur[k] ?? {}) as Record<string, unknown>,
          (was ?? {}) as Record<string, unknown>,
          (to ?? {}) as Record<string, unknown>,
        );
        continue;
      }
    }
    set[k] = to;
  }
  return out;
}

export function applyOp(d: VaultData, op: VaultOp): VaultData {
  switch (op.t) {
    case "txns": {
      const add = op.add.filter((t) => tracked(t, d.profile));
      return add.length ? { ...d, txns: mergeTxns(d.txns, add).txns } : d;
    }
    case "assign":
      return { ...d, overrides: { ...d.overrides, ...op.entries } };
    case "profile": {
      const profile = mergeProfile(d.profile, op.patch, op.from);
      return { ...d, profile, txns: profile.startDate ? d.txns.filter((t) => tracked(t, profile)) : d.txns };
    }
  }
}

export const applyOps = (d: VaultData, ops: VaultOp[]) => ops.reduce(applyOp, d);

/**
 * Trim an op to what it actually changes in `d` (recording the old values for
 * the three-way merge), or null if nothing. Keeps no-op edits, like a
 * settings field left without changing it, from being saved at all.
 */
export function minimiseOp(d: VaultData, op: VaultOp): VaultOp | null {
  switch (op.t) {
    case "txns": {
      const have = new Set(d.txns.map((t) => t.id));
      const add = op.add.filter((t) => !have.has(t.id) && tracked(t, d.profile));
      return add.length ? { t: "txns", add } : null;
    }
    case "assign": {
      const entries = Object.fromEntries(Object.entries(op.entries).filter(([k, v]) => d.overrides[k] !== v));
      return Object.keys(entries).length ? { t: "assign", entries } : null;
    }
    case "profile": {
      const cur = d.profile as Record<string, unknown>;
      const keys = Object.keys(op.patch).filter((k) => !same(cur[k], (op.patch as Record<string, unknown>)[k]));
      if (!keys.length) return null;
      const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Partial<Profile>;
      return { t: "profile", patch: pick(op.patch as Record<string, unknown>), from: pick(cur) };
    }
  }
}

/** True when a profile has nothing the owner set up (no rules, allowances, pay or debts). */
export function isBlankProfile(p: Profile): boolean {
  return (
    Object.keys(p.rules).length === 0 &&
    Object.keys(p.targets).length === 0 &&
    p.debts.length === 0 &&
    p.payAmount === undefined
  );
}

const OPTIONAL_SETTINGS = ["payAmount", "savingsTarget", "startingSavings", "bufferTarget", "emergencyTarget", "interestRate"] as const;

/** `cur`, with gaps filled from an older copy: nothing `cur` already has is changed. */
export function fillProfile(cur: Profile, old: Profile): Profile {
  const out: Profile = { ...cur, rules: { ...old.rules, ...cur.rules }, targets: { ...old.targets, ...cur.targets } };
  if (isBlankProfile(cur)) out.payday = old.payday;
  for (const k of OPTIONAL_SETTINGS) if (out[k] === undefined && old[k] !== undefined) out[k] = old[k];
  if (!cur.ownCardholders.length) out.ownCardholders = old.ownCardholders;
  if (!cur.allowedCardholders.length) out.allowedCardholders = old.allowedCardholders;
  out.debts = cur.debts.map((d) => {
    const o = old.debts.find((x) => x.name === d.name);
    if (!o?.log?.length) return d;
    const have = new Set((d.log ?? []).map((x) => x.period));
    const extra = o.log.filter((x) => !have.has(x.period));
    return extra.length ? { ...d, log: [...(d.log ?? []), ...extra].sort((a, b) => a.period.localeCompare(b.period)) } : d;
  });
  for (const o of old.debts) if (!cur.debts.some((d) => d.name === o.name)) out.debts.push(o);
  return out;
}

/**
 * Ops that fold this browser's old localStorage copy into the vault, adding
 * only what the vault lacks: new transactions, category choices it doesn't
 * have, and settings, rules, allowances and repayments it has no value for.
 * An old browser can never overwrite something newer.
 */
export function legacyOps(vault: VaultData, legacy: VaultData): VaultOp[] {
  const ops: VaultOp[] = [];
  const txns = minimiseOp(vault, { t: "txns", add: legacy.txns });
  if (txns) ops.push(txns);
  const newChoices = Object.fromEntries(Object.entries(legacy.overrides).filter(([k]) => !(k in vault.overrides)));
  if (Object.keys(newChoices).length) ops.push({ t: "assign", entries: newChoices });
  const profile = minimiseOp(vault, { t: "profile", patch: fillProfile(vault.profile, legacy.profile) });
  if (profile) ops.push(profile);
  return ops;
}
