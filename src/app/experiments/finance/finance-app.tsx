"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BUCKETS,
  type Assignment,
  type ColumnMapping,
  type Debt,
  type Period,
  type Profile,
  type Txn,
  bucketLabel,
  debtLogged,
  debtPayoff,
  debtRemaining,
  debtsForPeriod,
  logDebt,
  freshness,
  fromMappedCsv,
  importCsv,
  mergeTxns,
  normaliseDescription,
  normaliseProfile,
  parseAmount,
  parseDate,
  periodFor,
  periodProgress,
  planFor,
  project,
  recentPace,
  savingsGoals,
  shiftPeriod,
  summarise,
  topMerchants,
  tracked,
  type Recurring,
  suggestRecurring,
  toAssignment,
  upcomingCharges,
} from "@/lib/finance";
import { passphraseProblem, suggestPassphrase } from "@/lib/vault-crypto";
import type { VaultOp } from "@/lib/vault-sync";
import { type PhoneState, type SaveState, type VaultStatus, isWrongPassphrase, useVault } from "./use-vault";

// The data lives in the owner's vault on the site, encrypted in this browser
// with their passphrase (./use-vault.ts). Decrypted data is only ever in memory.

const aud0 = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const aud2 = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const money = (n: number) => aud0.format(Math.round(n));
const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const OVER = "#f87171"; // status: over budget (always paired with text + icon)
const FILL = "#d6d3d1"; // spend so far
const ASSIGN_OPTIONS: { id: Assignment; label: string }[] = [
  ...BUCKETS.map((b) => ({ id: b.id as Assignment, label: b.label })),
  { id: "transfer", label: "Transfer (not spending)" },
  { id: "ignore", label: "Ignore" },
];
const SOURCE_LABEL: Record<string, string> = {
  amex: "Amex",
  nab: "NAB",
  commbank: "CommBank",
  other: "Other",
  phone: "Phone",
  expected: "Expected",
};

type PendingFile = { name: string; rows: string[][]; mapping: ColumnMapping };

export function FinanceApp() {
  const vault = useVault();
  const { txns, profile, overrides } = vault.data;
  const ready = vault.status.s === "setup" || vault.status.s === "unlocked";
  const [period, setPeriod] = useState<Period>(() => periodFor(todayIso(), 15));
  const [focus, setFocus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Once the data is open (or replaced from another device), start on the current pay period.
  // Locked: clear import messages and half-mapped files, which show real transactions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(periodFor(todayIso(), vault.data.profile.payday));
    if (!ready) {
      setPending([]);
      setNotice(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status.s]);

  const updateProfile = (p: Profile) => vault.apply({ t: "profile", patch: p });
  const assign = (description: string, value: string) =>
    vault.apply({ t: "assign", entries: { [normaliseDescription(description)]: value } });

  // Regular charges that send no notification are counted on their usual day (see expectedCharges).
  const summary = useMemo(() => summarise(txns, period, profile, overrides, todayIso()), [txns, period, profile, overrides]);
  // Month by month: every pay period from the first transaction up to this one (or the one being viewed, if
  // later), 6 to 24 columns, none from before the "track from" date.
  const history = useMemo(() => {
    const now = periodFor(todayIso(), profile.payday);
    const last = period.start > now.start ? period : now;
    const first = txns.reduce((min, t) => (t.date < min ? t.date : min), period.start);
    let count = 6;
    while (count < 24 && shiftPeriod(last, -(count - 1), profile.payday).start > first) count++;
    const periods = Array.from({ length: count }, (_, i) => shiftPeriod(last, i - (count - 1), profile.payday));
    return periods
      .filter((p) => !profile.startDate || p.end >= profile.startDate)
      .map((p) => ({ period: p, s: summarise(txns, p, profile, overrides, todayIso()) }));
  }, [txns, period, profile, overrides]);
  const atStart = !!profile.startDate && period.start <= profile.startDate;
  const fresh = useMemo(() => freshness(txns), [txns]);
  const pace = useMemo(() => recentPace(txns, profile, overrides, todayIso()), [txns, profile, overrides]);
  const plan = planFor(profile);
  const progress = periodProgress(period, todayIso());

  async function onFiles(files: FileList | null) {
    if (!files) return;
    let txnsNow = txns;
    let profileNow = profile;
    const ops: VaultOp[] = [];
    const messages: string[] = [];
    const needMapping: PendingFile[] = [];
    // Profile and backup files first: the CSV importers use the profile's cardholder lists.
    const ordered = Array.from(files).sort(
      (a, b) => Number(!a.name.toLowerCase().endsWith(".json")) - Number(!b.name.toLowerCase().endsWith(".json")),
    );
    for (const file of ordered) {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data.txns)) {
            // A backup made by "Download backup". One from before "track from" was set keeps the date set here.
            const restored = normaliseProfile(data.profile);
            profileNow = { ...restored, startDate: restored.startDate ?? profileNow.startDate };
            const merged = mergeTxns(txnsNow, (data.txns as Txn[]).filter((t) => tracked(t, profileNow)));
            txnsNow = merged.txns;
            if (data.overrides && typeof data.overrides === "object") ops.push({ t: "assign", entries: data.overrides });
            messages.push(`${file.name}: restored backup (${merged.added} new transactions).`);
          } else {
            const imported = normaliseProfile(data);
            const before = profileNow;
            // Re-importing the profile file must not wipe repayments already logged here.
            profileNow = {
              ...imported,
              // A profile file without a "track from" date keeps the one set here.
              startDate: imported.startDate ?? before.startDate,
              debts: imported.debts.map((d: Debt) => {
                const prev = before.debts.find((x) => x.name === d.name);
                return prev?.log?.length ? { ...d, log: prev.log } : d;
              }),
            };
            messages.push(`${file.name}: profile loaded (${Object.keys(profileNow.rules).length} merchant rules).`);
          }
        } catch {
          messages.push(`${file.name}: not a valid JSON file.`);
        }
        continue;
      }
      const res = importCsv(text, profileNow);
      if (res.ok) {
        const keep = res.txns.filter((t) => tracked(t, profileNow));
        const merged = mergeTxns(txnsNow, keep);
        txnsNow = merged.txns;
        const early = res.txns.length - keep.length;
        messages.push(
          `${file.name}: ${merged.added} new transactions (${res.format})${early ? `; ${early} before your start date skipped` : ""}.`,
        );
      } else if (res.needsMapping) {
        needMapping.push({ name: file.name, rows: res.rows, mapping: guessMapping(res.rows) });
      } else {
        messages.push(`${file.name}: ${res.error}`);
      }
    }
    // A profile or backup with a later "track from" date deletes what's stored before it: ask first.
    if (profileNow.startDate && profileNow.startDate !== profile.startDate) {
      const from = `${short(profileNow.startDate)} ${profileNow.startDate.slice(0, 4)}`;
      const n = txns.filter((t) => !tracked(t, profileNow)).length;
      if (
        n > 0 &&
        !window.confirm(
          `This file sets "Track from" to ${from}, which deletes ${n} earlier transaction${n === 1 ? "" : "s"}. Continue?`,
        )
      ) {
        setNotice("Import cancelled; nothing was changed.");
        if (fileInput.current) fileInput.current.value = "";
        return;
      }
      messages.push(`Tracking from ${from}${n ? `; ${n} earlier transaction${n === 1 ? "" : "s"} deleted` : ""}.`);
    }
    if (profileNow !== profile) {
      ops.unshift({ t: "profile", patch: profileNow });
      setPeriod(periodFor(todayIso(), profileNow.payday));
    }
    const ids = new Set(txns.map((t) => t.id));
    const added = txnsNow.filter((t) => !ids.has(t.id));
    if (added.length) ops.push({ t: "txns", add: added });
    vault.apply(ops);
    setPending((p) => [...p, ...needMapping]);
    setNotice(messages.join(" ") || null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function importMapped(file: PendingFile) {
    const merged = mergeTxns(txns, fromMappedCsv(file.rows, file.mapping, profile).filter((t) => tracked(t, profile)));
    const ids = new Set(txns.map((t) => t.id));
    vault.apply({ t: "txns", add: merged.txns.filter((t) => !ids.has(t.id)) });
    setPending((p) => p.filter((x) => x !== file));
    setNotice(`${file.name}: ${merged.added} new transactions.`);
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ profile, overrides, txns }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `finance-backup-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deleteEverything() {
    if (!window.confirm("Delete all your transactions, rules and settings from the site and this device? This can't be undone.")) return;
    if (
      !window.confirm(
        "Really delete everything? Download a backup first if you might want it back. (Cloudflare's own database backups keep the encrypted copy for up to 30 days.)",
      )
    )
      return;
    try {
      await vault.deleteEverything();
      setNotice("Everything was deleted from the site and this device.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const budgetRows = BUCKETS.filter(
    (b) => (profile.targets[b.id] ?? 0) > 0 || Math.abs(summary.byBucket[b.id] ?? 0) > 0.005,
  );
  const uncategorised = summary.txns.filter((t) => t.assignment === "uncategorised");
  const pay = summary.income > 0 ? summary.income : plan.pay;
  const debtsThisMonth = debtsForPeriod(profile, period);
  const canStillSpend = pay - plan.savings - debtsThisMonth - summary.spent;
  const isCurrent = progress > 0 && progress < 1;
  const visibleTxns = summary.txns.filter((t) =>
    focus ? t.assignment === focus : t.kind === "spend" || t.kind === "income",
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        {/* A full page load, not next/link: the finance page's CSP must not follow the user onto other pages. */}
        <a
          href="/experiments"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Experiments
        </a>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">Finance · private</div>
      </header>

      <section className="px-6 sm:px-12 pt-8 pb-6 max-w-5xl">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.02em]">Spending</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted leading-relaxed">
          Drop in CSV exports from CommBank, NAB and Amex. They are read in this browser, encrypted with your
          passphrase and saved to your site, so every device you unlock sees the same data. Nobody can read it without
          the passphrase — not even the site.
        </p>
        {ready && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded border border-rule px-4 py-2 text-sm hover:border-muted">
              Import CSV / profile
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            {txns.length > 0 && (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                Data through{" "}
                {Object.entries(fresh)
                  .map(([s, d]) => `${SOURCE_LABEL[s] ?? s} ${short(d)}`)
                  .join(" · ")}
              </span>
            )}
          </div>
        )}
        {vault.status.s === "unlocked" && <SaveLine save={vault.save} onRetry={vault.retry} />}
        {(notice || vault.notice) && (
          <p className="mt-3 text-sm text-foreground/80">{[vault.notice, notice].filter(Boolean).join(" ")}</p>
        )}
      </section>

      <VaultPanel
        status={vault.status}
        onSetup={vault.setup}
        onUnlock={vault.unlock}
        onDelete={deleteEverything}
        onDiscard={() => {
          if (window.confirm("Remove the data shown here from this browser, without saving it to your site?")) {
            vault.discardLocal();
            setPending([]);
            setNotice("Removed from this browser. Nothing was saved to your site.");
          }
        }}
        hasData={txns.length > 0}
      />

      {pending.map((f) => (
        <MappingForm
          key={f.name}
          file={f}
          onChange={(mapping) => setPending((p) => p.map((x) => (x === f ? { ...x, mapping } : x)))}
          onImport={() => importMapped(f)}
          onCancel={() => setPending((p) => p.filter((x) => x !== f))}
        />
      ))}

      {!ready ? null : txns.length === 0 ? (
        <section className="border-t border-rule px-6 sm:px-12 py-12 max-w-3xl text-sm text-muted leading-relaxed">
          <p>
            No data yet. Import your profile file first (it holds your merchant rules and monthly allowances), then
            your exports. Re-importing an overlapping export is safe — transactions already stored are skipped.
          </p>
          <Explainer />
        </section>
      ) : (
        <>
          {/* Month (pay period) navigation */}
          <section className="border-t border-rule px-6 sm:px-12 py-6 flex flex-wrap items-center gap-4">
            <button
              className="rounded border border-rule px-3 py-1 text-sm hover:border-muted disabled:opacity-40 disabled:hover:border-rule"
              onClick={() => setPeriod(shiftPeriod(period, -1, profile.payday))}
              disabled={atStart}
              aria-label="Previous month"
            >
              ←
            </button>
            <div className="text-lg font-medium">
              {short(period.start)} – {short(period.end)} {period.end.slice(0, 4)}
            </div>
            <button
              className="rounded border border-rule px-3 py-1 text-sm hover:border-muted"
              onClick={() => setPeriod(shiftPeriod(period, 1, profile.payday))}
              aria-label="Next month"
            >
              →
            </button>
            {!isCurrent && (
              <button
                className="text-sm text-muted underline hover:text-foreground"
                onClick={() => setPeriod(periodFor(todayIso(), profile.payday))}
              >
                This month
              </button>
            )}
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Pay period starting on payday (the {profile.payday}
              {ordinal(profile.payday)})
              {isCurrent && ` · ${Math.round(progress * 100)}% through`}
            </span>
          </section>

          {/* The plan: pay -> savings -> allowances, and what is actually left */}
          <section className="border-t border-rule px-6 sm:px-12 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-5xl">
            <Tile label="Pay" value={money(pay)} note={summary.income > 0 ? "received this period" : "from settings"} />
            <Tile label="Savings first" value={money(plan.savings)} note="set aside on payday" />
            <Tile label="Spent so far" value={money(summary.spent)} note={`${summary.txns.length} transactions`} />
            <Tile
              label={canStillSpend >= 0 ? "Left before touching savings" : "Eating into savings"}
              value={money(Math.abs(canStillSpend))}
              note={
                canStillSpend >= 0
                  ? `pay − savings − debts (${money(debtsThisMonth)}) − spent`
                  : "⚠ spending is past pay minus savings and debts"
              }
              warn={canStillSpend < 0}
            />
          </section>

          {isCurrent && upcomingCharges(period, profile, todayIso()).length > 0 && (
            <p className="border-t border-rule px-6 sm:px-12 py-4 text-sm text-muted max-w-5xl">
              Coming up:{" "}
              {upcomingCharges(period, profile, todayIso())
                .map(({ r, date }) => `${r.name} ${money(r.amount)} on ${short(date)}`)
                .join(" · ")}
            </p>
          )}

          {profile.debts.length > 0 && <DebtsSection profile={profile} period={period} onChange={updateProfile} />}

          {/* Category allowances */}
          <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Where it went · left in each category
              </h2>
              {isCurrent && (
                <span className="font-mono text-[11px] text-muted">│ = where you&apos;d be at an even pace</span>
              )}
            </div>
            <ul className="mt-4 divide-y divide-rule">
              {budgetRows.map((b) => (
                <BucketRow
                  key={b.id}
                  id={b.id}
                  label={b.label}
                  spent={summary.byBucket[b.id] ?? 0}
                  target={profile.targets[b.id] ?? 0}
                  pace={isCurrent ? progress : null}
                  open={focus === b.id}
                  onToggle={() => setFocus(focus === b.id ? null : b.id)}
                  merchants={topMerchants(summary.txns, b.id)}
                />
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted">
              <span>
                Allowances {money(plan.allowances)} · savings {money(plan.savings)} · debts {money(plan.debts)} ·{" "}
                {plan.unallocated >= 0 ? (
                  <>unallocated {money(plan.unallocated)}</>
                ) : (
                  <span style={{ color: OVER }}>⚠ plan is {money(-plan.unallocated)} more than pay</span>
                )}
              </span>
              {summary.supplementary > 0 && (
                <span>Supplementary cards {money(summary.supplementary)} (not counted; to be reimbursed)</span>
              )}
            </div>
          </section>

          <SavingsSection profile={profile} onChange={updateProfile} pace={pace} />

          {uncategorised.length > 0 && (
            <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                Needs a category ({uncategorised.length})
              </h2>
              <p className="mt-2 text-sm text-muted">Choosing a category applies to every transaction at that merchant.</p>
              <TxnList rows={uncategorised} onAssign={assign} />
            </section>
          )}

          <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
                {focus ? `${bucketLabel(focus)} transactions` : "All transactions this period"}
              </h2>
              {focus && (
                <button className="text-sm text-muted underline hover:text-foreground" onClick={() => setFocus(null)}>
                  Show all
                </button>
              )}
            </div>
            <TxnList rows={visibleTxns} onAssign={assign} />
          </section>

          {history.length > 0 && (
            <History
              rows={history}
              profile={profile}
              current={period}
              onOpen={(p) => {
                setPeriod(p);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </>
      )}

      {ready && txns.length === 0 && (
        <SavingsSection profile={profile} onChange={updateProfile} pace={null} />
      )}

      {ready && (
        <Settings
          profile={profile}
          onChange={updateProfile}
          onBackup={downloadBackup}
          earlierThan={(date) => txns.filter((t) => t.date < date).length}
        >
          <RecurringSettings profile={profile} txns={txns} overrides={overrides} onChange={updateProfile} />
          {vault.status.s === "unlocked" && (
            <PhoneSettings
              phone={vault.phone}
              onConnect={vault.connectPhone}
              onDisconnect={vault.disconnectPhone}
              onDismiss={vault.dismissNote}
              onCheck={vault.checkPhone}
            />
          )}
          {vault.status.s === "unlocked" && (
            <VaultSettings
              remembered={vault.remembered}
              onChangePassphrase={vault.changePassphrase}
              onLock={vault.lockDevice}
              pendingCount={vault.pendingCount}
              onDelete={deleteEverything}
            />
          )}
        </Settings>
      )}
    </div>
  );
}

function SaveLine({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  const at = save.at
    ? new Date(save.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted" role="status">
      {save.state === "saving" ? (
        "Saving…"
      ) : save.state === "error" ? (
        <span className="normal-case tracking-normal" style={{ color: save.kind === "offline" ? undefined : OVER }}>
          ⚠ {save.error}{" "}
          {save.kind === "signin" && (
            <>
              <a className="underline" href="/experiments/finance" target="_blank" rel="noopener">
                Sign in again
              </a>{" "}
              (opens a new tab), then{" "}
            </>
          )}
          <button className="underline" onClick={onRetry}>
            {save.kind === "signin" ? "try again" : "Try again"}
          </button>
        </span>
      ) : (
        <>🔒 Encrypted · saved to your site{at ? ` · ${at}` : ""}</>
      )}
    </p>
  );
}

/** Two password fields for a new passphrase, with a "suggest one" option. */
function NewPassphrase({
  pass,
  confirm,
  onPass,
  onConfirm,
}: {
  pass: string;
  confirm: string;
  onPass: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const problem = pass ? passphraseProblem(pass) : null;
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">New passphrase</span>
        <input
          type="password"
          autoComplete="new-password"
          className="rounded border border-rule bg-background px-3 py-2"
          value={pass}
          onChange={(e) => {
            onPass(e.target.value);
            setSuggested(null);
          }}
          autoFocus
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Type it again</span>
        <input
          type="password"
          autoComplete="new-password"
          className="rounded border border-rule bg-background px-3 py-2"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="self-start text-sm text-muted underline hover:text-foreground"
        onClick={() => {
          const p = suggestPassphrase();
          onPass(p);
          onConfirm(p);
          setSuggested(p);
        }}
      >
        Suggest a strong passphrase
      </button>
      {suggested && (
        <div className="rounded border border-rule px-3 py-2 text-sm">
          <code className="select-all break-all font-mono">{suggested}</code>
          <button
            type="button"
            className="ml-3 text-muted underline hover:text-foreground"
            onClick={() => navigator.clipboard?.writeText(suggested)}
          >
            Copy
          </button>
          <p className="mt-1 text-xs text-muted">Save it in your password manager before you continue.</p>
        </div>
      )}
      {problem && (
        <p className="text-sm" aria-live="polite" style={{ color: OVER }}>
          {problem}
        </p>
      )}
      {confirm.length > 0 && confirm !== pass && (
        <p className="text-sm" aria-live="polite" style={{ color: OVER }}>
          The two passphrases don&apos;t match.
        </p>
      )}
    </>
  );
}

/** First visit: choose a passphrase. Saved but not on this device yet: unlock. */
function VaultPanel({
  status,
  onSetup,
  onUnlock,
  onDelete,
  onDiscard,
  hasData,
}: {
  status: VaultStatus;
  onSetup: (passphrase: string, remember: boolean) => Promise<void>;
  onUnlock: (passphrase: string, remember: boolean) => Promise<void>;
  /** Delete what's saved on the site (asks twice). Needs no passphrase. */
  onDelete: () => void;
  /** Before anything is saved: clear this browser's copy instead. */
  onDiscard: () => void;
  hasData: boolean;
}) {
  const passInput = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status.s === "loading") {
    return <p className="border-t border-rule px-6 sm:px-12 py-8 text-sm text-muted">Loading your data…</p>;
  }
  if (status.s === "unavailable") {
    return (
      <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-2xl text-sm">
        <p role="alert" style={{ color: OVER }}>⚠ Couldn&apos;t load your data. {status.error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="rounded border border-rule px-4 py-2 hover:border-muted" onClick={() => location.reload()}>
            {status.signIn ? "Sign in again" : "Reload"}
          </button>
          {status.damaged && (
            <button className="rounded border border-rule px-4 py-2 text-muted hover:border-muted" onClick={onDelete}>
              Delete the saved copy and start again
            </button>
          )}
        </div>
      </section>
    );
  }
  if (status.s === "unlocked") return null;

  const setup = status.s === "setup";
  const blocked = setup ? passphraseProblem(pass) !== null || confirm !== pass : pass.length === 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await (setup ? onSetup : onUnlock)(pass, remember);
      setPass("");
      setConfirm("");
    } catch (err) {
      setError(isWrongPassphrase(err) ? "That passphrase doesn't unlock your data." : err instanceof Error ? err.message : String(err));
      passInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-2xl">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        {setup ? "Save to your site" : "Unlock your data"}
      </h2>
      {status.reason && <p className="mt-3 text-sm text-foreground/80">{status.reason}</p>}
      <p className="mt-3 text-sm text-muted leading-relaxed">
        {setup ? (
          <>
            Choose a passphrase. Your data is encrypted with it in this browser before it&apos;s saved, so nobody can read
            it without the passphrase — not even the site. You type it once on each device. Keep it in your password
            manager: if you forget it and no device still remembers it, the saved copy can&apos;t be opened.
            {hasData && " What's on this page now will be saved."}
          </>
        ) : (
          "Enter your passphrase to open your data on this device."
        )}
      </p>
      <form className="mt-4 flex flex-col gap-3 sm:max-w-sm" onSubmit={submit}>
        {/* Lets a password manager file the passphrase under something recognisable. */}
        <input type="text" name="username" autoComplete="username" value="ericlau.io finance" readOnly hidden />
        {setup ? (
          <NewPassphrase pass={pass} confirm={confirm} onPass={setPass} onConfirm={setConfirm} />
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Passphrase</span>
            <input
              ref={passInput}
              type="password"
              autoComplete="current-password"
              className="rounded border border-rule bg-background px-3 py-2"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              aria-describedby={error ? "vault-error" : undefined}
              autoFocus
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device
        </label>
        {error && (
          <p id="vault-error" role="alert" className="text-sm" style={{ color: OVER }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || blocked}
          className="self-start rounded border border-rule px-4 py-2 text-sm hover:border-muted disabled:opacity-50"
        >
          {busy ? (setup ? "Encrypting and saving…" : "Unlocking…") : setup ? "Save to my site" : "Unlock"}
        </button>
      </form>
      {setup && hasData && (
        <p className="mt-6 text-xs text-muted">
          Shared computer?{" "}
          <button type="button" className="underline hover:text-foreground" onClick={onDiscard}>
            Remove this data from this browser
          </button>{" "}
          without saving it.
        </p>
      )}
      {!setup && (
        <p className="mt-6 text-xs text-muted">
          Forgot your passphrase, and no device remembers it?{" "}
          <button type="button" className="underline hover:text-foreground" onClick={onDelete}>
            Delete the saved data and start again
          </button>
          . Transactions can be re-imported from your bank files and profile.
        </p>
      )}
    </section>
  );
}

function VaultSettings({
  remembered,
  onChangePassphrase,
  onLock,
  onDelete,
  pendingCount,
}: {
  remembered: boolean;
  onChangePassphrase: (passphrase: string, remember: boolean) => Promise<void>;
  onLock: (discardUnsaved?: boolean) => Promise<void>;
  onDelete: () => void;
  pendingCount: () => number;
}) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done || null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  async function lock() {
    setBusy(true);
    setMsg(null);
    try {
      await onLock();
    } catch (e) {
      const n = pendingCount();
      if (n && window.confirm(`${e instanceof Error ? e.message : String(e)} Lock anyway and lose ${n === 1 ? "it" : "them"}?`)) {
        await onLock(true).catch((err) => setMsg(err instanceof Error ? err.message : String(err)));
      } else if (!n) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-8">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Passphrase & this device</h3>
      <p className="mt-2 text-sm text-muted">
        {remembered
          ? "This device remembers your passphrase, so the page opens without asking. Lock it on a shared device."
          : "This device asks for your passphrase each visit."}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button className="rounded border border-rule px-4 py-2 hover:border-muted" onClick={() => setOpen(!open)}>
          Change passphrase
        </button>
        <button
          className="rounded border border-rule px-4 py-2 hover:border-muted disabled:opacity-50"
          disabled={busy}
          onClick={lock}
        >
          Lock this device
        </button>
        <button className="rounded border border-rule px-4 py-2 hover:border-muted" onClick={onDelete}>
          Delete everything saved on the site
        </button>
      </div>
      {open && (
        <form
          className="mt-4 flex flex-col gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (passphraseProblem(pass) || pass !== confirm) return;
            void run(async () => {
              await onChangePassphrase(pass, remembered);
              setPass("");
              setConfirm("");
              setOpen(false);
            }, "Passphrase changed. Older saved versions under the old passphrase were deleted from the site (Cloudflare's own database backups keep them for up to 30 days). Other devices will ask for the new one.");
          }}
        >
          <input type="text" name="username" autoComplete="username" value="ericlau.io finance" readOnly hidden />
          <NewPassphrase pass={pass} confirm={confirm} onPass={setPass} onConfirm={setConfirm} />
          <button
            type="submit"
            disabled={busy || passphraseProblem(pass) !== null || pass !== confirm}
            className="self-start rounded border border-rule px-4 py-2 text-sm hover:border-muted disabled:opacity-50"
          >
            {busy ? "Re-encrypting…" : "Save new passphrase"}
          </button>
        </form>
      )}
      {msg && <p className="mt-3 text-sm text-foreground/80">{msg}</p>}
    </div>
  );
}

function monthLabel(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const HORIZONS = [6, 12, 24, 36, 60];
const LINE = "#60a5fa"; // savings balance
const DEBT = "#fb923c"; // debt still owed

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? 10 * pow;
}

const toNum = (v: string) => {
  const n = parseAmount(v);
  return n === null || n < 0 ? undefined : n;
};

function DebtsSection({ profile, period, onChange }: { profile: Profile; period: Period; onChange: (p: Profile) => void }) {
  const [other, setOther] = useState<Record<number, string>>({});
  const setDebt = (i: number, d: Debt) => onChange({ ...profile, debts: profile.debts.map((x, j) => (j === i ? d : x)) });
  return (
    <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Debts · flexible this month</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Repayments are planned, not fixed. In a tight month, pay less or skip — the balance only drops by what you
        actually pay, and the payoff date moves out.
      </p>
      <ul className="mt-4 divide-y divide-rule text-sm">
        {profile.debts.map((d, i) => {
          const left = debtRemaining(d);
          const logged = debtLogged(d, period);
          const { payments } = debtPayoff(d);
          const due = Math.min(d.payment, left);
          const finish = Number.isFinite(payments) ? monthLabel((logged !== undefined ? 1 : 0) + payments - 1) : "never";
          return (
            <li key={`${i}-${d.name}`} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base text-foreground/90">{d.name}</span>
                <span className="text-muted">
                  {left > 0
                    ? `${money(left)} left · usually ${money(d.payment)}/mo · ${payments} payment${payments === 1 ? "" : "s"} to go (last ${finish})`
                    : "✓ paid off"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {logged !== undefined ? (
                  <>
                    <span className="text-foreground/90">
                      {logged > 0 ? `✓ Paid ${aud2.format(logged)} this month` : "Skipped this month"}
                    </span>
                    <button className="text-muted underline hover:text-foreground" onClick={() => setDebt(i, logDebt(d, period, null))}>
                      Undo
                    </button>
                  </>
                ) : left > 0 ? (
                  <>
                    <button
                      className="rounded border border-rule px-3 py-1 hover:border-muted"
                      onClick={() => setDebt(i, logDebt(d, period, due))}
                    >
                      Paid {money(due)}
                    </button>
                    <input
                      inputMode="decimal"
                      placeholder="Other amount"
                      aria-label={`Other amount paid on ${d.name}`}
                      className="w-32 rounded border border-rule bg-background px-2 py-1"
                      value={other[i] ?? ""}
                      onChange={(e) => setOther({ ...other, [i]: e.target.value })}
                    />
                    <button
                      className="rounded border border-rule px-3 py-1 hover:border-muted"
                      onClick={() => {
                        const n = toNum(other[i] ?? "");
                        if (n === undefined) return;
                        setDebt(i, logDebt(d, period, Math.min(n, left)));
                        setOther({ ...other, [i]: "" });
                      }}
                    >
                      Log
                    </button>
                    <button
                      className="rounded border border-rule px-3 py-1 text-muted hover:border-muted"
                      onClick={() => setDebt(i, logDebt(d, period, 0))}
                    >
                      Skip this month
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DebtEditor({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const update = (i: number, patch: Partial<Debt>) =>
    onChange({ ...profile, debts: profile.debts.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  return (
    <div className="mt-8">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Debts</h3>
      <p className="mt-1 text-xs text-muted">
        &ldquo;Owed when added&rdquo; is the balance on the day you add the debt; repayments you log come off it.
      </p>
      {profile.debts.map((d, i) => (
        <div key={`${i}-${d.name}`} className="mt-3 grid items-end gap-3 text-sm sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Name</span>
            <input
              className="rounded border border-rule bg-background px-3 py-2"
              defaultValue={d.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === d.name) return;
                // Debts are matched by name when syncing, so two can't share one.
                if (!v || profile.debts.some((x, j) => j !== i && x.name === v)) {
                  if (v) window.alert(`You already have a debt called “${v}”.`);
                  e.target.value = d.name;
                  return;
                }
                update(i, { name: v });
              }}
            />
          </label>
          <Field label="Owed when added" value={d.balance} onChange={(v) => update(i, { balance: toNum(v) ?? 0 })} />
          <Field label="Usual monthly repayment" value={d.payment} onChange={(v) => update(i, { payment: toNum(v) ?? 0 })} />
          <button
            className="rounded border border-rule px-3 py-2 text-muted hover:border-muted"
            onClick={() => onChange({ ...profile, debts: profile.debts.filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="mt-3 rounded border border-rule px-3 py-2 text-sm hover:border-muted"
        onClick={() => {
          const names = new Set(profile.debts.map((d) => d.name));
          let n = profile.debts.length + 1;
          while (names.has(`Debt ${n}`)) n++;
          onChange({ ...profile, debts: [...profile.debts, { name: `Debt ${n}`, balance: 0, payment: 0, log: [] }] });
        }}
      >
        Add debt
      </button>
    </div>
  );
}

function SavingsSection({
  profile,
  onChange,
  pace,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  pace: number | null;
}) {
  const plan = planFor(profile);
  const goals = savingsGoals(profile);
  const [monthly, setMonthly] = useState<number>(profile.savingsTarget ?? 0);
  const [months, setMonths] = useState(24);
  const [rollover, setRollover] = useState(true);
  const hasDebt = profile.debts.some((d) => debtRemaining(d) > 0);
  const start = profile.startingSavings ?? 0;
  const proj = project({
    start,
    monthly,
    months,
    annualRate: profile.interestRate,
    buffer: goals.buffer,
    emergency: goals.emergency,
    debts: profile.debts,
    rollover,
  });
  const end = proj.points[proj.points.length - 1];
  const milestone = (m: number | null) =>
    m === null ? `not within ${months} months` : m === 0 ? "already there" : `${monthLabel(m)} (${m} month${m === 1 ? "" : "s"})`;
  const num = (v: string) => {
    const n = parseAmount(v);
    return n === null ? undefined : n;
  };
  const bufferHave = Math.min(start, goals.buffer);

  return (
    <section className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Savings &amp; buffer</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted leading-relaxed">
        Step 1 is a buffer of one month&apos;s spending ({money(goals.buffer)}). Once it&apos;s full, each payday&apos;s
        money goes into the buffer and you spend last month&apos;s pay — so you never borrow from next month. Step 2 is
        an emergency fund ({money(goals.emergency)}) on top. After that, savings are free for goals.
      </p>

      <div className="mt-5 max-w-xl">
        <div className="flex justify-between text-sm">
          <span className="text-foreground/90">Buffer</span>
          <span className="text-muted">
            {money(bufferHave)} of {money(goals.buffer)}
            {bufferHave >= goals.buffer ? " · ✓ full — spend last month's pay" : ` · ${money(goals.buffer - bufferHave)} to go`}
          </span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-rule" title={`Buffer ${money(bufferHave)} of ${money(goals.buffer)}`}>
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${goals.buffer ? (bufferHave / goals.buffer) * 100 : 0}%`, background: LINE }}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Saved so far</span>
          <input
            inputMode="decimal"
            className="rounded border border-rule bg-background px-3 py-2"
            key={String(profile.startingSavings ?? "")}
            defaultValue={profile.startingSavings ?? ""}
            onBlur={(e) => {
              if (e.target.value !== String(profile.startingSavings ?? "")) {
                onChange({ ...profile, startingSavings: Math.max(0, num(e.target.value) ?? 0) });
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Save each month</span>
          <input
            inputMode="decimal"
            className="rounded border border-rule bg-background px-3 py-2"
            value={Number.isFinite(monthly) ? Math.round(monthly * 100) / 100 : 0}
            onChange={(e) => setMonthly(num(e.target.value) ?? 0)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Over</span>
          <select
            className="rounded border border-rule bg-background px-3 py-2"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h} months ({monthLabel(h)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Interest % p.a. (optional)</span>
          <input
            inputMode="decimal"
            className="rounded border border-rule bg-background px-3 py-2"
            key={String(profile.interestRate ?? "")}
            defaultValue={profile.interestRate ?? ""}
            onBlur={(e) => {
              if (e.target.value !== String(profile.interestRate ?? "")) onChange({ ...profile, interestRate: num(e.target.value) });
            }}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button
          className="rounded border border-rule px-3 py-1 hover:border-muted"
          onClick={() => setMonthly(plan.savings)}
        >
          My plan: {money(plan.savings)}/mo
        </button>
        {plan.unallocated >= 1 && (
          <button
            className="rounded border border-rule px-3 py-1 hover:border-muted"
            onClick={() => setMonthly(plan.savings + plan.unallocated)}
            title="If the unallocated part of pay also went to savings"
          >
            Plan + unallocated: {money(plan.savings + plan.unallocated)}/mo
          </button>
        )}
        {pace !== null && (
          <button
            className="rounded border border-rule px-3 py-1 hover:border-muted"
            onClick={() => setMonthly(pace)}
            title="Average of pay minus spending over the last 3 finished months"
          >
            If nothing changes: {money(pace)}/mo
          </button>
        )}
      </div>

      {hasDebt && (
        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
          When a debt is paid off, move its repayment into savings
        </label>
      )}

      <ProjectionChart points={proj.points} buffer={goals.buffer} emergency={goals.buffer + goals.emergency} />

      <ul className="mt-4 space-y-1 text-sm">
        <li>
          <span className="text-muted">Buffer ({money(goals.buffer)}) reached: </span>
          {milestone(proj.bufferMonth)}
        </li>
        <li>
          <span className="text-muted">Buffer + emergency fund ({money(goals.buffer + goals.emergency)}) reached: </span>
          {milestone(proj.emergencyMonth)}
        </li>
        {hasDebt && (
          <li>
            <span className="text-muted">Debt-free (paying the usual amount each month): </span>
            {milestone(proj.debtFreeMonth)}
          </li>
        )}
        <li>
          <span className="text-muted">By {monthLabel(months)}: </span>
          <span className="text-foreground/90 font-medium">{money(end.balance)}</span>
          <span className="text-muted">
            {" "}
            ({money(start)} now{" "}
            {end.contributed >= 0 ? `+ ${money(end.contributed)} saved` : `− ${money(-end.contributed)} shortfall`}
            {end.interest > 0.5 ? ` + ${money(end.interest)} interest` : ""})
          </span>
        </li>
        {monthly <= 0 && (
          <li style={{ color: OVER }}>⚠ At this rate savings don&apos;t grow — spending is using up the whole pay.</li>
        )}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-3 tabular-nums">
          <tbody className="divide-y divide-rule">
            {proj.points
              .filter((p) => p.month % (months > 24 ? 6 : 3) === 0)
              .map((p) => (
                <tr key={p.month}>
                  <td className="py-1 pr-8 text-muted">{p.month === 0 ? "Now" : monthLabel(p.month)}</td>
                  <td className="py-1 text-right">{money(p.balance)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function ProjectionChart({
  points,
  buffer,
  emergency,
}: {
  points: { month: number; balance: number; debt: number }[];
  buffer: number;
  emergency: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const showDebt = points.some((p) => p.debt > 0);
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const pad = { l: 56, r: 16, t: 12, b: 28 };
  const w = Math.max(width - pad.l - pad.r, 10);
  const h = H - pad.t - pad.b;
  const balances = points.map((p) => p.balance);
  const raw = { max: Math.max(...balances, ...points.map((p) => p.debt), emergency, 1), min: Math.min(0, ...balances) };
  const step = niceStep((raw.max - raw.min) / 4);
  const yMax = Math.ceil(raw.max / step) * step;
  const yMin = Math.floor(raw.min / step) * step;
  const n = points.length - 1;
  const x = (m: number) => pad.l + (n ? (m / n) * w : 0);
  const y = (v: number) => pad.t + h - ((v - yMin) / (yMax - yMin)) * h;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + step * i);
  const xStep = n <= 12 ? 3 : n <= 36 ? 6 : 12;
  const line = (get: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.month).toFixed(1)},${y(get(p)).toFixed(1)}`).join("");
  const kfmt = (v: number) => {
    const a = Math.abs(v);
    const body = a >= 1000 ? `$${+(a / 1000).toFixed(a % 1000 ? 1 : 0)}k` : `$${Math.round(a)}`;
    return v < 0 ? `−${body}` : body;
  };
  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative mt-6 w-full">
      {showDebt && (
        <div className="mb-2 flex gap-5 text-xs text-muted">
          <span className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: LINE }} /> Savings
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: DEBT }} /> Debt owed
          </span>
        </div>
      )}
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Projected savings balance by month"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const m = Math.round(((e.clientX - rect.left - pad.l) / w) * n);
            setHover(m >= 0 && m <= n ? m : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {kfmt(t)}
              </text>
            </g>
          ))}
          {points
            .filter((p) => p.month % xStep === 0)
            .map((p) => (
              <text
                key={p.month}
                x={x(p.month)}
                y={H - 8}
                textAnchor={p.month === 0 ? "start" : p.month === n ? "end" : "middle"}
                fontSize="11"
                fill="var(--muted)"
              >
                {p.month === 0 ? "Now" : monthLabel(p.month)}
              </text>
            ))}
          {[
            { v: buffer, label: `Buffer ${kfmt(buffer)}` },
            { v: emergency, label: `+ Emergency ${kfmt(emergency)}` },
          ].map((g) => (
            <g key={g.label}>
              <line
                x1={pad.l}
                x2={pad.l + w}
                y1={y(g.v)}
                y2={y(g.v)}
                stroke="var(--muted)"
                strokeDasharray="4 4"
              />
              <text x={pad.l + 4} y={y(g.v) - 5} fontSize="11" fill="var(--muted)">
                {g.label}
              </text>
            </g>
          ))}
          {showDebt && <path d={line((p) => p.debt)} fill="none" stroke={DEBT} strokeWidth={2} strokeLinejoin="round" />}
          <path d={line((p) => p.balance)} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
          {hp && (
            <g>
              <line x1={x(hp.month)} x2={x(hp.month)} y1={pad.t} y2={pad.t + h} stroke="var(--muted)" />
              {showDebt && (
                <circle cx={x(hp.month)} cy={y(hp.debt)} r={4} fill={DEBT} stroke="var(--background)" strokeWidth={2} />
              )}
              <circle cx={x(hp.month)} cy={y(hp.balance)} r={4} fill={LINE} stroke="var(--background)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hp && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-rule bg-background px-2 py-1 text-xs"
          style={{ left: Math.min(Math.max(x(hp.month) - 60, 0), Math.max(width - 150, 0)) }}
        >
          <div className="text-muted">{hp.month === 0 ? "Now" : monthLabel(hp.month)}</div>
          <div className="text-foreground">Savings {money(hp.balance)}</div>
          {showDebt && <div className="text-foreground">Debt owed {money(hp.debt)}</div>}
        </div>
      )}
    </div>
  );
}

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

function Tile({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight" style={warn ? { color: OVER } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  );
}

function BucketRow(props: {
  id: string;
  label: string;
  spent: number;
  target: number;
  pace: number | null;
  open: boolean;
  onToggle: () => void;
  merchants: { merchant: string; amount: number; count: number }[];
}) {
  const { label, spent, target, pace, open, onToggle, merchants } = props;
  const left = target - spent;
  const over = target > 0 && left < 0;
  const ratio = target > 0 ? Math.min(Math.max(spent / target, 0), 1) : 0;
  const status =
    target <= 0 ? "no allowance set" : over ? `⚠ over by ${money(-left)}` : `${money(left)} left`;
  return (
    <li className="py-4">
      <button className="w-full text-left" onClick={onToggle} aria-expanded={open}>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-base text-foreground/90">{label}</span>
          <span className="text-sm text-muted shrink-0">
            <span className="text-foreground/90">{money(spent)}</span>
            {target > 0 && <> of {money(target)}</>}
            {" · "}
            <span style={over ? { color: OVER } : undefined}>{status}</span>
          </span>
        </div>
        {target > 0 && (
          <div
            className="relative mt-2 h-2 rounded-full bg-rule"
            title={`${label}: ${money(spent)} spent of ${money(target)}`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${ratio * 100}%`, background: over ? OVER : FILL }}
            />
            {pace !== null && (
              <div className="absolute -inset-y-1 w-0.5 bg-muted" style={{ left: `calc(${pace * 100}% - 1px)` }} />
            )}
          </div>
        )}
      </button>
      {open && merchants.length > 0 && (
        <ul className="mt-3 ml-1 space-y-1 text-sm text-muted">
          {merchants.map((m) => (
            <li key={m.merchant} className="flex justify-between gap-4">
              <span className="truncate">
                {m.merchant} <span className="text-xs">×{m.count}</span>
              </span>
              <span className="text-foreground/80 shrink-0">{money(m.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Charges that come every month without a notification (e.g. a subscription on a card). */
function RecurringSettings({
  profile,
  txns,
  overrides,
  onChange,
}: {
  profile: Profile;
  txns: Txn[];
  overrides: Record<string, string>;
  onChange: (p: Profile) => void;
}) {
  const list = profile.recurring ?? [];
  const suggestions = useMemo(() => suggestRecurring(txns, profile, overrides), [txns, profile, overrides]);
  const set = (next: Recurring[]) => onChange({ ...profile, recurring: next });
  const update = (id: string, patch: Partial<Recurring>) => set(list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const newId = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now()));
  return (
    <div className="mt-8">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Regular charges</h3>
      <p className="mt-1 text-xs text-muted">
        For charges that never send a notification, like a subscription on your card. Each one counts on its usual day
        until the real charge shows up (from a statement), so nothing is counted twice.
      </p>
      {list.map((r) => (
        <div key={r.id} className="mt-3 grid items-end gap-3 text-sm grid-cols-2 sm:grid-cols-5">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted">Name</span>
            <input
              key={r.name}
              className="rounded border border-rule bg-background px-3 py-2"
              defaultValue={r.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== r.name) update(r.id, { name: v });
              }}
            />
          </label>
          <Field
            label="Amount"
            value={r.amount}
            onChange={(v) => {
              const n = parseAmount(v);
              if (n !== null && n >= 0) update(r.id, { amount: n });
            }}
          />
          <Field
            label="Day of month"
            value={r.day}
            onChange={(v) => {
              const n = Math.round(Number(v));
              if (n >= 1 && n <= 31) update(r.id, { day: n });
            }}
          />
          <div className="flex items-end gap-2">
            <select
              className="flex-1 rounded border border-rule bg-background px-2 py-2 text-xs"
              value={toBucket(r.category)}
              onChange={(e) => update(r.id, { category: e.target.value })}
              aria-label={`Category for ${r.name}`}
            >
              {BUCKETS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <button
              className="rounded border border-rule px-3 py-2 text-muted hover:border-muted"
              onClick={() => set(list.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.name}`}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        className="mt-3 rounded border border-rule px-3 py-2 text-sm hover:border-muted"
        onClick={() => set([...list, { id: newId(), name: "New charge", amount: 0, day: 1, category: "subscriptions" }])}
      >
        Add a regular charge
      </button>
      {suggestions.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="text-muted">Looks regular in your history:</p>
          <ul className="mt-2 space-y-1">
            {suggestions.map((sg) => (
              <li key={sg.match} className="flex flex-wrap items-center gap-x-3">
                <span className="text-foreground/90">{sg.name}</span>
                <span className="text-muted">
                  {money(sg.amount)} around the {sg.day}
                  {ordinal(sg.day)} · {bucketLabel(toBucket(sg.category))}
                </span>
                <button className="underline text-muted hover:text-foreground" onClick={() => set([...list, { ...sg, id: newId() }])}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A category from the rules ("groceries") or a bucket id, as the bucket it counts against. */
const toBucket = (category: string) => (BUCKETS.some((b) => b.id === category) ? category : (toAssignment(category) ?? "essentials"));

/** Connecting the phone feed: Google Wallet, Amex, NAB and CommBank notifications, forwarded by MacroDroid. */
function PhoneSettings({
  phone,
  onConnect,
  onDisconnect,
  onDismiss,
  onCheck,
}: {
  phone: PhoneState;
  onConnect: () => Promise<string>;
  onDisconnect: () => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
  onCheck: () => Promise<void>;
}) {
  const [phoneKey, setPhoneKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const endpoint = typeof window === "undefined" ? "/api/finance/notify" : `${window.location.origin}/api/finance/notify`;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => setMsg("Copied."));
  return (
    <div className="mt-8">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Your phone</h3>
      <p className="mt-2 text-sm text-muted">
        {phone.connected
          ? `Connected${phone.connectedAt ? ` (key from ${when(phone.connectedAt)})` : ""}. Payments your phone reports appear here within a minute while this page is open.${phone.checkedAt ? ` Last checked ${when(phone.checkedAt)}${phone.filed ? `, ${phone.filed} new` : ""}.` : ""}`
          : "Not connected. Your phone can send each payment notification (Google Wallet, Amex, NAB, CommBank) here as it happens, encrypted on arrival."}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button
          className="rounded border border-rule px-4 py-2 hover:border-muted disabled:opacity-50"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (phone.connected && !window.confirm("Make a new phone key? The current one stops working until you put the new one in MacroDroid.")) return;
              setPhoneKey(await onConnect());
            })
          }
        >
          {phone.connected ? "New phone key" : "Connect your phone"}
        </button>
        {phone.connected && (
          <>
            <button className="rounded border border-rule px-4 py-2 hover:border-muted disabled:opacity-50" disabled={busy} onClick={() => run(onCheck)}>
              Check now
            </button>
            <button
              className="rounded border border-rule px-4 py-2 hover:border-muted disabled:opacity-50"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm("Disconnect your phone? Its key stops working and anything waiting is deleted.")) return;
                  await onDisconnect();
                  setPhoneKey(null);
                })
              }
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      {phoneKey && (
        <div className="mt-4 max-w-2xl rounded border border-rule p-4 text-sm leading-relaxed">
          <p className="text-foreground/80">Put these in MacroDroid&apos;s HTTP Request action. The key is shown only now.</p>
          <dl className="mt-3 grid gap-2">
            <dt className="text-muted">URL (method POST)</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-xs">{endpoint}</code>
              <button className="underline text-muted" onClick={() => copy(endpoint)}>
                Copy
              </button>
            </dd>
            <dt className="text-muted">Header: name Authorization, value</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-xs select-all">Bearer {phoneKey}</code>
              <button className="underline text-muted" onClick={() => copy(`Bearer ${phoneKey}`)}>
                Copy
              </button>
            </dd>
            <dt className="text-muted">Body (content type text/plain), using MacroDroid&apos;s magic text</dt>
            <dd>
              <code className="block whitespace-pre font-mono text-xs">{"app=[notification app name]\ntitle=[notification title]\ntext=[notification text]"}</code>
            </dd>
          </dl>
          <p className="mt-3 text-muted">
            Then switch the macro on, pay for something with your phone, and press Check now. Anyone with this key can add
            to your drop box (never read from it): if it leaks, press New phone key.
          </p>
        </div>
      )}
      {phone.unreadable.length > 0 && (
        <div className="mt-4 max-w-2xl text-sm">
          <p className="text-foreground/80">Notifications with an amount that couldn&apos;t be filed ({phone.unreadable.length}):</p>
          <ul className="mt-2 divide-y divide-rule">
            {phone.unreadable.map((u) => (
              <li key={u.id} className="flex flex-wrap items-start gap-x-3 py-2">
                <span className="flex-1 min-w-[12rem] text-muted">
                  <span className="text-foreground/90">{u.note.title}</span> {u.note.text} <span className="text-xs">({u.note.app})</span>
                </span>
                <button className="underline text-muted hover:text-foreground" onClick={() => run(() => onDismiss(u.id))}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-foreground/80">{msg}</p>}
    </div>
  );
}

function TxnList({
  rows,
  onAssign,
}: {
  rows: (Txn & { assignment: string })[];
  onAssign: (description: string, value: string) => void;
}) {
  if (!rows.length) return <p className="mt-4 text-sm text-muted">Nothing here.</p>;
  return (
    <ul className="mt-4 divide-y divide-rule text-sm">
      {rows.slice(0, 300).map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
          <span className="w-14 shrink-0 font-mono text-xs text-muted">{short(t.date)}</span>
          <span className="flex-1 min-w-[10rem] truncate text-foreground/90">
            {t.description}
            {t.provisional && (
              <span className="ml-2 font-mono text-[10px] uppercase text-muted" title={`From your phone (${t.via ?? "notification"}); replaced when the statement row arrives`}>
                · phone
              </span>
            )}
            {t.expected && (
              <span className="ml-2 font-mono text-[10px] uppercase text-muted" title="A regular charge, counted on its usual day until the real one shows up">
                · expected
              </span>
            )}
          </span>
          <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-muted">
            {SOURCE_LABEL[t.source] ?? t.source}
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums">
            {t.amount < 0 ? `+${aud2.format(-t.amount)}` : aud2.format(t.amount)}
          </span>
          {t.expected ? (
            <span className="w-44 shrink-0 text-xs text-muted">{bucketLabel(t.category ?? "")}</span>
          ) : t.kind === "spend" ? (
            <select
              className="w-44 shrink-0 rounded border border-rule bg-background px-2 py-1 text-xs"
              value={t.assignment === "uncategorised" ? "" : t.assignment}
              onChange={(e) => onAssign(t.description, e.target.value)}
              aria-label={`Category for ${t.description}`}
            >
              {t.assignment === "uncategorised" && <option value="">Choose…</option>}
              {ASSIGN_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="w-44 shrink-0 text-xs text-muted">{t.kind === "income" ? "Income" : t.kind}</span>
          )}
        </li>
      ))}
      {rows.length > 300 && <li className="py-2 text-muted">…and {rows.length - 300} more</li>}
    </ul>
  );
}

function History({
  rows,
  profile,
  current,
  onOpen,
}: {
  rows: { period: Period; s: ReturnType<typeof summarise> }[];
  profile: Profile;
  current: Period;
  onOpen: (p: Period) => void;
}) {
  const plan = planFor(profile);
  // Start scrolled to the newest months (the table is wider than a phone).
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [rows.length]);
  const buckets = BUCKETS.filter(
    (b) => (profile.targets[b.id] ?? 0) > 0 || rows.some((r) => Math.abs(r.s.byBucket[b.id] ?? 0) > 0.005),
  );
  return (
    <section className="border-t border-rule px-6 sm:px-12 py-8">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Month by month</h2>
      <p className="mt-1 text-xs text-muted">Tap a month to open it.</p>
      {/* Only the table scrolls sideways; the category column stays in view. */}
      <div ref={scroller} className="mt-4 overflow-x-auto">
      <table className="min-w-[44rem] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-muted">
            <th className="sticky left-0 bg-background py-2 pr-6 font-normal">Category</th>
            {rows.map((r) => (
              <th key={r.period.start} className="py-2 pr-6 text-right font-normal whitespace-nowrap">
                <button
                  className={
                    r.period.start === current.start ? "text-foreground underline" : "hover:text-foreground hover:underline"
                  }
                  onClick={() => onOpen(r.period)}
                  aria-label={`Open ${short(r.period.start)} ${r.period.start.slice(0, 4)}`}
                >
                  {short(r.period.start)}
                  {r.period.start.slice(5, 7) === "01" || r.period.start.slice(5, 7) === "12" ? ` ${r.period.start.slice(2, 4)}` : ""}
                </button>
              </th>
            ))}
            <th className="py-2 text-right font-normal">Allowance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {buckets.map((b) => {
            const target = profile.targets[b.id] ?? 0;
            return (
              <tr key={b.id}>
                <td className="sticky left-0 bg-background py-2 pr-6 text-foreground/90">{b.label}</td>
                {rows.map((r) => {
                  const v = r.s.byBucket[b.id] ?? 0;
                  const over = target > 0 && v > target;
                  return (
                    <td key={r.period.start} className="py-2 pr-6 text-right" style={over ? { color: OVER } : undefined}>
                      {v ? money(v) : "—"}
                      {over && " ▲"}
                    </td>
                  );
                })}
                <td className="py-2 text-right text-muted">{target ? money(target) : "—"}</td>
              </tr>
            );
          })}
          {rows.some((r) => r.s.byBucket.uncategorised) && (
            <tr>
              <td className="sticky left-0 bg-background py-2 pr-6 text-muted">Uncategorised</td>
              {rows.map((r) => (
                <td key={r.period.start} className="py-2 pr-6 text-right text-muted">
                  {r.s.byBucket.uncategorised ? money(r.s.byBucket.uncategorised) : "—"}
                </td>
              ))}
              <td />
            </tr>
          )}
          <tr className="font-medium">
            <td className="sticky left-0 bg-background py-2 pr-6">Total spent</td>
            {rows.map((r) => (
              <td key={r.period.start} className="py-2 pr-6 text-right">
                {money(r.s.spent)}
              </td>
            ))}
            <td className="py-2 text-right text-muted">{money(plan.allowances)}</td>
          </tr>
          <tr>
            <td className="sticky left-0 bg-background py-2 pr-6 text-muted">Pay − debts − spent</td>
            {rows.map((r) => {
              const pay = r.s.income > 0 ? r.s.income : plan.pay;
              const left = pay - debtsForPeriod(profile, r.period) - r.s.spent;
              const short_ = left < plan.savings;
              return (
                <td
                  key={r.period.start}
                  className="py-2 pr-6 text-right"
                  style={short_ ? { color: OVER } : undefined}
                  title={short_ ? "Less than the savings target was left" : undefined}
                >
                  {money(left)}
                  {short_ && " ▲"}
                </td>
              );
            })}
            <td className="py-2 text-right text-muted">save {money(plan.savings)}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        ▲ = over the allowance, or less than the savings target left over. Debts use what you logged that month,
        otherwise the usual repayment.
      </p>
    </section>
  );
}

function Settings({
  profile,
  onChange,
  onBackup,
  earlierThan,
  children,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  onBackup: () => void;
  /** How many stored transactions fall before a date (for the "track from" warning). */
  earlierThan?: (date: string) => number;
  children?: ReactNode;
}) {
  const num = (v: string) => {
    const n = parseAmount(v);
    return n === null || n < 0 ? undefined : n;
  };
  const plan = planFor(profile);
  return (
    <details className="border-t border-rule px-6 sm:px-12 py-8 max-w-5xl">
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        Plan & settings
      </summary>
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Field label="Take-home pay per month" value={profile.payAmount} onChange={(v) => onChange({ ...profile, payAmount: num(v) })} />
        <Field
          label="Payday (day of month)"
          value={profile.payday}
          onChange={(v) => {
            const n = Math.round(Number(v));
            if (n >= 1 && n <= 31) onChange({ ...profile, payday: n });
          }}
        />
        <Field
          label="Savings, set aside first"
          value={profile.savingsTarget}
          onChange={(v) => onChange({ ...profile, savingsTarget: num(v) })}
        />
        <Field
          label="Buffer (blank = one month of allowances)"
          value={profile.bufferTarget}
          onChange={(v) => onChange({ ...profile, bufferTarget: num(v) })}
        />
        <Field
          label="Emergency fund (blank = 3 months)"
          value={profile.emergencyTarget}
          onChange={(v) => onChange({ ...profile, emergencyTarget: num(v) })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Track from (earlier transactions are deleted)</span>
          <input
            key={profile.startDate ?? ""}
            type="date"
            className="rounded border border-rule bg-background px-3 py-2"
            defaultValue={profile.startDate ?? ""}
            onBlur={(e) => {
              // A half-typed date reads as "": put the saved one back rather than clearing it.
              if (e.target.validity.badInput) {
                e.target.value = profile.startDate ?? "";
                return;
              }
              const v = e.target.value || undefined;
              if (v === profile.startDate) return;
              if (v && earlierThan && earlierThan(v) > 0) {
                const n = earlierThan(v);
                if (!window.confirm(`Delete ${n} transaction${n === 1 ? "" : "s"} before ${short(v)} ${v.slice(0, 4)}? Re-importing your files won't bring them back while this date is set.`)) {
                  e.target.value = profile.startDate ?? "";
                  return;
                }
              }
              onChange({ ...profile, startDate: v });
            }}
          />
        </label>
      </div>
      <h3 className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Monthly allowance per category</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {BUCKETS.map((b) => (
          <Field
            key={b.id}
            label={b.label}
            value={profile.targets[b.id]}
            onChange={(v) => onChange({ ...profile, targets: { ...profile.targets, [b.id]: num(v) } })}
          />
        ))}
      </div>
      <DebtEditor profile={profile} onChange={onChange} />
      <p className="mt-6 text-sm text-muted">
        Pay {money(plan.pay)} − savings {money(plan.savings)} − debts {money(plan.debts)} − allowances{" "}
        {money(plan.allowances)} ={" "}
        <span style={plan.unallocated < 0 ? { color: OVER } : undefined}>
          {money(plan.unallocated)} unallocated
        </span>
        {plan.unallocated < 0 && " ⚠ — the plan spends more than you earn"}
      </p>
      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <button className="rounded border border-rule px-4 py-2 hover:border-muted" onClick={onBackup}>
          Download backup (unencrypted)
        </button>
      </div>
      {children}
      <Explainer />
    </details>
  );
}

function Field({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        inputMode="decimal"
        className="rounded border border-rule bg-background px-3 py-2"
        // Keyed by the stored value, so a change saved from another device shows up here.
        key={String(value ?? "")}
        defaultValue={value ?? ""}
        onBlur={(e) => {
          if (e.target.value !== String(value ?? "")) onChange(e.target.value);
        }}
      />
    </label>
  );
}

function Explainer() {
  return (
    <div className="mt-6 max-w-2xl space-y-2 text-sm text-muted leading-relaxed">
      <p className="text-foreground/80">How the budget works</p>
      <p>
        A month runs from payday to the day before the next payday. On payday, savings come off the top; the rest is
        split into category allowances. Every purchase lands in one category, and each category shows what&apos;s left
        of its allowance. The pace marker shows where spending would be if it were spread evenly across the month.
      </p>
      <p>
        Card repayments and transfers between your own accounts are not spending, so they are excluded (otherwise a
        purchase would count twice: once on the card and again when the card is paid). Refunds reduce their category.
        Supplementary cardholders&apos; spending is shown separately and not counted against your allowances.
      </p>
      <p className="text-foreground/80">How your data is kept private</p>
      <p>
        Files are read in this browser. Before anything is saved, it is encrypted here with a key made from your
        passphrase, so the site only ever stores scrambled data that it cannot read. Each device you unlock downloads
        that copy and decrypts it locally. The passphrase never leaves your device. If you forget it and no device
        still remembers it, the saved copy can&apos;t be opened. The unlock screen lets you delete it and start again:
        transactions can be re-imported from your bank files, but category choices, logged repayments and settings
        made here are lost unless you downloaded a backup. Keep the passphrase in your password manager.
      </p>
    </div>
  );
}

function guessMapping(rows: string[][]): ColumnMapping {
  const first = rows[0] ?? [];
  const hasHeader = !first.some((c) => parseDate(c));
  const sample = hasHeader ? rows[1] ?? [] : first;
  const date = Math.max(0, sample.findIndex((c) => parseDate(c)));
  const amount = Math.max(0, sample.findIndex((c, i) => i !== date && parseAmount(c) !== null));
  const description = Math.max(
    0,
    sample.findIndex((c, i) => i !== date && i !== amount && parseAmount(c) === null && c.trim().length > 2),
  );
  return { source: "other", hasHeader, date, description, amount, spendSign: "negative" };
}

function MappingForm({
  file,
  onChange,
  onImport,
  onCancel,
}: {
  file: PendingFile;
  onChange: (m: ColumnMapping) => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const m = file.mapping;
  const header = m.hasHeader ? file.rows[0] : file.rows[0].map((_, i) => `Column ${i + 1}`);
  const sample = file.rows[m.hasHeader ? 1 : 0] ?? [];
  const cols = header.map((h, i) => ({ i, label: `${h || `Column ${i + 1}`} — e.g. ${sample[i] ?? ""}`.slice(0, 60) }));
  const pick = (key: "date" | "description" | "amount") => (
    <label className="flex flex-col gap-1">
      <span className="text-muted capitalize">{key}</span>
      <select
        className="rounded border border-rule bg-background px-2 py-1"
        value={m[key]}
        onChange={(e) => onChange({ ...m, [key]: Number(e.target.value) })}
      >
        {cols.map((c) => (
          <option key={c.i} value={c.i}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="border-t border-rule px-6 sm:px-12 py-6 max-w-5xl text-sm">
      <p className="text-foreground/90">
        {file.name}: I don&apos;t recognise this layout. Which columns are which?
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {pick("date")}
        {pick("description")}
        {pick("amount")}
        <label className="flex flex-col gap-1">
          <span className="text-muted">Account</span>
          <select
            className="rounded border border-rule bg-background px-2 py-1"
            value={m.source}
            onChange={(e) => onChange({ ...m, source: e.target.value })}
          >
            {Object.entries(SOURCE_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Purchases appear as</span>
          <select
            className="rounded border border-rule bg-background px-2 py-1"
            value={m.spendSign}
            onChange={(e) => onChange({ ...m, spendSign: e.target.value as ColumnMapping["spendSign"] })}
          >
            <option value="negative">negative numbers (−45.20)</option>
            <option value="positive">positive numbers (45.20)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end">
          <input type="checkbox" checked={m.hasHeader} onChange={(e) => onChange({ ...m, hasHeader: e.target.checked })} />
          <span className="text-muted">First row is a header</span>
        </label>
      </div>
      <div className="mt-4 flex gap-3">
        <button className="rounded border border-rule px-4 py-2 hover:border-muted" onClick={onImport}>
          Import
        </button>
        <button className="text-muted underline hover:text-foreground" onClick={onCancel}>
          Skip this file
        </button>
      </div>
    </section>
  );
}
