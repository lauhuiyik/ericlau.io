"use client";

import { useEffect, useState } from "react";
import { MAX_CT_CHARS, type VaultEnvelope, type VaultKdf, parseEnvelope } from "@/lib/vault-envelope";
import { WrongPassphraseError, deriveKey, newKdf, open, seal } from "@/lib/vault-crypto";
import { forgetKey, forgetKeyFor, recallKey, rememberKey } from "@/lib/vault-device";
import { newInboxKeys, newPhoneToken, openInbox, parseInboxEnvelope, sha256Hex } from "@/lib/vault-inbox";
import { MANUAL_VIA, PAYMENT_VIAS, type PhoneNote, readNote } from "@/lib/phone-feed";
import type { Txn } from "@/lib/finance";
import {
  EMPTY_DATA,
  type PhoneLogEntry,
  type VaultData,
  type VaultOp,
  applyOp,
  applyOps,
  fromPlaintext,
  isBlankProfile,
  legacyOps,
  repeatedPhoneRows,
  minimiseOp,
  toPlaintext,
} from "@/lib/vault-sync";

/**
 * The finance data, kept in the owner's encrypted vault on the site.
 *
 * Decrypted data lives only in memory. Every edit is applied at once and
 * queued as an op; a save (1.2 s after the last edit, at most 5 s after the
 * first, and at once when the tab is hidden) seals the whole state under the
 * vault key and PUTs it with the version it was based on. If another device
 * saved first (409), the newer vault is fetched, decrypted, and the queued ops
 * are replayed on top before trying again (see src/lib/vault-sync.ts).
 * Queued edits survive failed saves: offline, an expired login, or a
 * passphrase changed elsewhere all keep them until they can be saved.
 */

export type VaultStatus =
  | { s: "loading" }
  | { s: "setup"; reason?: string } // nothing saved on the site yet
  | { s: "locked"; reason?: string } // saved, but this device doesn't have the key
  | { s: "unlocked" }
  | { s: "unavailable"; error: string; signIn?: boolean; damaged?: boolean }; // couldn't load the vault

export type SaveState = {
  state: "idle" | "saving" | "error";
  at?: string;
  error?: string;
  /** offline: retries by itself. signin: the Access login expired; sign in again in another tab, then retry. */
  kind?: "offline" | "signin" | "other";
};

type Remote = { version: number; envelope: VaultEnvelope; updatedAt: string };

/** The phone feed, as this page sees it. */
export type PhoneState = {
  connected: boolean;
  connectedAt?: string;
  /** Notifications with an amount that couldn't be filed: shown to the owner to sort or dismiss. */
  unreadable: { id: string; note: PhoneNote; why: string }[];
  /** How many payments the last check filed. */
  filed?: number;
  checkedAt?: string;
};

const PHONE_POLL_MS = 60_000;

const ENDPOINT = "/experiments/finance/vault";
const SAVE_DELAY_MS = 1200;
const SAVE_MAX_WAIT_MS = 5000;
const RETRY_MS = [5000, 15000, 60000];
const PASSPHRASE_CHANGED = "Your passphrase was changed on another device. Enter the new one.";
const DELETED_ELSEWHERE = "Your saved data was deleted from another device.";

// Where this browser kept the data before the vault. Merged into the vault once, then removed.
const LEGACY = { txns: "finance:v1:txns", profile: "finance:v1:profile", overrides: "finance:v1:overrides" };

function readLegacy(): VaultData | null {
  try {
    const get = (key: string) => {
      const s = window.localStorage.getItem(key);
      if (!s) return undefined;
      try {
        return JSON.parse(s);
      } catch {
        return undefined;
      }
    };
    const raw = { txns: get(LEGACY.txns), profile: get(LEGACY.profile), overrides: get(LEGACY.overrides) };
    if (raw.txns === undefined && raw.profile === undefined && raw.overrides === undefined) return null;
    return fromPlaintext(raw);
  } catch {
    return null;
  }
}

function clearLegacy() {
  try {
    for (const key of Object.values(LEGACY)) window.localStorage.removeItem(key);
  } catch {}
}

class Conflict extends Error {}
class NeedsUnlock extends Error {}
class Offline extends Error {
  constructor() {
    super("You're offline.");
  }
}
class SignIn extends Error {
  constructor() {
    super("Your sign-in has expired.");
  }
}
class Damaged extends Error {
  constructor() {
    super(
      "The data saved on the site looks damaged. If your data is open on another device, download a backup there; then delete the saved copy and start again.",
    );
  }
}

async function api(method: "GET" | "PUT" | "DELETE", body?: unknown, query = ""): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT + query, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      // When the Access session has expired, Access answers with a redirect to its login page.
      redirect: "manual",
      headers: {
        ...(method === "GET" ? {} : { "x-finance-vault": "1" }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Offline();
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || res.status === 401) throw new SignIn();
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 409) throw new Conflict();
  if (res.status === 403) {
    const reason = String(json?.reason ?? json?.error ?? "forbidden");
    if (/expired|not yet valid/.test(reason)) throw new SignIn();
    throw new Error(`The site refused: ${reason}.`);
  }
  if (!res.ok || !json) throw new Error(`The site couldn't load or save the data (${String(json?.error ?? res.status)}).`);
  return json;
}

async function getRemote(): Promise<Remote | null> {
  const r = await api("GET");
  if (!r.exists) return null;
  const parsed = parseEnvelope(r.envelope);
  if (!parsed.ok || typeof r.version !== "number") throw new Damaged();
  return { version: r.version, envelope: parsed.envelope, updatedAt: String(r.updatedAt) };
}

function tooBig(env: VaultEnvelope) {
  if (env.ct.length > MAX_CT_CHARS) throw new Error("There's too much data to save on the site. Download a backup.");
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Why a save failed, and what happens to the edits. */
const saveError = (e: unknown) =>
  e instanceof Offline
    ? "You're offline. Your changes are kept here and will save when you're back online."
    : e instanceof SignIn
      ? "Your sign-in has expired. Your changes are kept on this page."
      : message(e);
const kindOf = (e: unknown): SaveState["kind"] => (e instanceof Offline ? "offline" : e instanceof SignIn ? "signin" : "other");

type Setters = {
  setStatus: (s: VaultStatus) => void;
  setData: (d: VaultData) => void;
  setSave: (s: SaveState) => void;
  setRemembered: (r: boolean) => void;
  setNotice: (n: string | null) => void;
  setPhone: (p: PhoneState) => void;
};

/** The sync engine: plain closures over mutable state, created once per page. */
function createVault(ui: Setters) {
  let data: VaultData = EMPTY_DATA;
  let version = 0;
  let key: CryptoKey | null = null;
  let kdf: VaultKdf | null = null;
  let remote: Remote | null = null;
  let pending: VaultOp[] = [];
  let firstPendingAt = 0;
  let legacy: VaultData | null = null;
  /** `legacy` is this page's unsaved data (not a localStorage copy): leaving the page would lose it. */
  let legacyFromPage = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let inflight: Promise<void> | null = null;
  let lastSaveFailed = false;
  let saveState: SaveState = { state: "idle" };
  let phone: PhoneState = { connected: false, unreadable: [] };
  let pulling: Promise<void> | null = null;

  const setSave = (s: SaveState) => {
    saveState = s;
    ui.setSave(s);
  };
  const show = (d: VaultData) => {
    data = d;
    ui.setData(d);
  };
  const setPhone = (p: PhoneState) => {
    phone = p;
    ui.setPhone(p);
  };
  const remember = async (k: CryptoKey, params: VaultKdf, yes: boolean) => {
    if (yes) ui.setRemembered(await rememberKey(k, params));
    else {
      await forgetKey();
      ui.setRemembered(false);
    }
  };
  const lockWith = (reason: string) => {
    const stale = kdf?.salt;
    key = null;
    kdf = null;
    ui.setRemembered(false);
    if (stale) void forgetKeyFor(stale);
    ui.setStatus({ s: "locked", reason });
  };
  const goneElsewhere = () => {
    // Deleted from another device: respect it, unless this page has edits that were never saved.
    const stale = kdf?.salt;
    key = null;
    kdf = null;
    version = 0;
    remote = null;
    if (stale) void forgetKeyFor(stale);
    ui.setRemembered(false);
    if (!pending.length) show(EMPTY_DATA);
    ui.setStatus({
      s: "setup",
      reason: pending.length
        ? `${DELETED_ELSEWHERE} This page still has changes that weren't saved; choose a passphrase to save this copy again.`
        : `${DELETED_ELSEWHERE} Import your files and choose a passphrase to start again.`,
    });
  };
  const accept = (env: VaultEnvelope, res: Record<string, unknown>) => {
    version = res.version as number;
    remote = { version, envelope: env, updatedAt: res.updatedAt as string };
    lastSaveFailed = false;
    retries = 0;
    setSave({ state: "idle", at: remote.updatedAt });
  };
  const ack = (sent: number) => {
    pending = pending.slice(sent);
    firstPendingAt = pending.length ? Date.now() : 0;
  };

  /** After a 409: fetch the newer vault and replay the unsaved ops on it. */
  async function rebase() {
    const fresh = await getRemote();
    if (!fresh) {
      goneElsewhere();
      throw new NeedsUnlock();
    }
    remote = fresh;
    if (!key || fresh.envelope.kdf.salt !== kdf?.salt) {
      lockWith(`${PASSPHRASE_CHANGED} Your unsaved changes are kept and will be saved after you unlock.`);
      throw new NeedsUnlock();
    }
    const base = fromPlaintext(await open(key, fresh.envelope));
    version = fresh.version;
    show(applyOps(base, pending));
  }

  async function saveNow() {
    setSave({ ...saveState, state: "saving" });
    try {
      for (let attempt = 0; ; attempt++) {
        const sent = pending.length;
        const env = await seal(key!, kdf!, toPlaintext(data, new Date().toISOString()));
        tooBig(env);
        try {
          const res = await api("PUT", { baseVersion: version, envelope: env });
          accept(env, res);
          ack(sent);
          if (legacy) {
            clearLegacy();
            legacy = null;
          }
          return;
        } catch (e) {
          if (!(e instanceof Conflict) || attempt >= 3) throw e;
          await rebase();
        }
      }
    } catch (e) {
      lastSaveFailed = true;
      if (e instanceof NeedsUnlock) {
        setSave({ state: "error", at: saveState.at, kind: "other", error: "Not saved yet: unlock to save your changes." });
        return;
      }
      setSave({ state: "error", at: saveState.at, kind: kindOf(e), error: saveError(e) });
      if (e instanceof Offline) retryLater();
    }
  }

  function retryLater() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)]);
  }

  /** Save queued edits now (waits for a save already in flight, then saves anything newer). */
  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    while (inflight) await inflight;
    if (!key || !kdf || pending.length === 0) return;
    inflight = saveNow();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
    // Edits made while that save was in flight get their own save.
    if (pending.length && key && !lastSaveFailed) schedule();
  }

  function schedule() {
    if (!key) return;
    if (timer) clearTimeout(timer);
    // 1.2 s after the last edit, but never more than 5 s after the first unsaved one.
    const wait = Math.max(0, Math.min(SAVE_DELAY_MS, SAVE_MAX_WAIT_MS - (Date.now() - firstPendingAt)));
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  }

  /** Decrypt the fetched vault with `k`, replay anything unsaved, and fold in this browser's old local copy. */
  async function openWith(k: CryptoKey, params: VaultKdf) {
    const r = remote!;
    const base = fromPlaintext(await open(k, r.envelope)); // throws WrongPassphraseError
    key = k;
    kdf = params;
    version = r.version;
    let next = applyOps(base, pending);
    if (legacy) {
      const ops = legacyOps(next, legacy);
      if (ops.length) {
        next = applyOps(next, ops);
        if (!pending.length) firstPendingAt = Date.now();
        pending.push(...ops);
        ui.setNotice("This browser's earlier copy of your data was added to your saved data.");
      } else {
        clearLegacy();
        legacy = null;
      }
    }
    show(next);
    setSave({ state: "idle", at: r.updatedAt });
    ui.setStatus({ s: "unlocked" });
    if (pending.length) schedule();
    void pullInbox();
  }

  /** Apply edits now and queue what actually changed for the next save. */
  function applyEdits(ops: VaultOp | VaultOp[]) {
    let next = data;
    const list: VaultOp[] = [];
    for (const op of Array.isArray(ops) ? ops : [ops]) {
      const real = minimiseOp(next, op);
      if (!real) continue;
      next = applyOp(next, real);
      list.push(real);
    }
    if (!list.length) return;
    show(next);
    if (!pending.length) firstPendingAt = Date.now();
    pending.push(...list);
    lastSaveFailed = false;
    schedule();
  }

  /**
   * File what the phone sent: decrypt each drop-box entry with the vault's
   * private key, read it into a provisional transaction, save, and only then
   * delete the entries (a failed save leaves them to be read again; re-filing
   * is a no-op because ids are stable).
   */
  async function pullInbox(): Promise<void> {
    if (pulling) return pulling;
    pulling = (async () => {
      // Phone rows filed before only payment apps counted (an email or a shop's promotion): drop them.
      const misread = [
        ...data.txns.filter((t) => t.provisional && t.via !== MANUAL_VIA && !PAYMENT_VIAS.includes(t.via ?? "")).map((t) => t.id),
        ...repeatedPhoneRows(data.txns),
      ];
      if (misread.length && key) applyEdits({ t: "remove", ids: misread });
      // Phone rows still waiting for their statement row are re-read from the saved notification text, so a
      // fix to how notifications are read (e.g. a purchase taken for a refund) corrects them too.
      if (key) {
        const byId = new Map(data.txns.map((t) => [t.id, t]));
        const fixes: VaultOp[] = [];
        for (const e of data.phoneLog ?? []) {
          const old = e.result === "filed" && e.txnId ? byId.get(e.txnId) : undefined;
          if (!old?.provisional) continue;
          const res = readNote({ app: e.app, title: e.title, text: e.text, receivedAt: e.receivedAt, postedAt: old.at });
          if (res.kind === "txn") {
            const now = res.txn;
            if (now.amount === old.amount && now.kind === old.kind && now.source === old.source && now.description === old.description) continue;
            fixes.push({ t: "remove", ids: [old.id] }, { t: "txns", add: [now] }, { t: "phoneLog", add: [{ ...e, txnId: now.id }] });
          } else {
            const result = res.kind === "ignore" ? ("skipped" as const) : ("unreadable" as const);
            fixes.push({ t: "remove", ids: [old.id] }, { t: "phoneLog", add: [{ ...e, result, why: res.why, txnId: undefined }] });
          }
        }
        if (fixes.length) applyEdits(fixes);
      }
      for (let round = 0; round < 5 && key; round++) {
        let r: Record<string, unknown>;
        try {
          r = await api("GET", undefined, "/inbox");
        } catch {
          return;
        }
        const entries = (Array.isArray(r.entries) ? r.entries : []) as { id: string; envelope: unknown }[];
        const base = { connected: !!r.connected, connectedAt: r.connectedAt as string | undefined, checkedAt: new Date().toISOString() };
        const keys = data.phone;
        if (!keys || !entries.length) {
          setPhone({ ...phone, ...base, filed: 0 });
          return;
        }
        const add: Txn[] = [];
        const done: string[] = [];
        const unreadable: PhoneState["unreadable"] = [];
        const log: PhoneLogEntry[] = [];
        for (const e of entries) {
          const env = parseInboxEnvelope(e.envelope);
          let note: PhoneNote | null = null;
          if (env) {
            try {
              note = await openInbox<PhoneNote>(keys.privateJwk, env);
            } catch {
              // Sealed to a key this vault no longer has (the phone was reconnected): it can never be read.
            }
          }
          if (!note) {
            done.push(e.id);
            continue;
          }
          const res = readNote(note);
          log.push({
            id: e.id,
            receivedAt: note.receivedAt,
            app: note.app,
            title: note.title,
            text: note.text,
            ...(res.kind === "txn"
              ? { result: "filed" as const, txnId: res.txn.id }
              : { result: res.kind === "ignore" ? ("skipped" as const) : ("unreadable" as const), why: res.why }),
          });
          if (res.kind === "txn") {
            add.push(res.txn);
            done.push(e.id);
          } else if (res.kind === "ignore") done.push(e.id);
          else unreadable.push({ id: e.id, note, why: res.why });
        }
        if (add.length) applyEdits({ t: "txns", add });
        if (log.length) applyEdits({ t: "phoneLog", add: log });
        await flush();
        const saved = !pending.length && !lastSaveFailed;
        if (done.length && saved) {
          try {
            await api("DELETE", { ids: done }, "/inbox");
          } catch {
            // Left in the drop box: read (harmlessly) again next time.
          }
        }
        setPhone({ ...base, unreadable, filed: add.length });
        if (!r.more || !saved || !done.length) return;
      }
    })();
    try {
      await pulling;
    } finally {
      pulling = null;
    }
  }

  async function load(isCancelled: () => boolean) {
    legacy = readLegacy();
    let r: Remote | null;
    try {
      r = await getRemote();
    } catch (e) {
      if (isCancelled()) return;
      const error =
        e instanceof Offline
          ? "You're offline. Reload the page when you're back online."
          : e instanceof SignIn
            ? "Your sign-in has expired. Sign in again to open your data."
            : message(e);
      ui.setStatus({ s: "unavailable", error, signIn: e instanceof SignIn, damaged: e instanceof Damaged });
      return;
    }
    if (isCancelled()) return;
    if (!r) {
      show(legacy ?? EMPTY_DATA);
      ui.setStatus({ s: "setup" });
      return;
    }
    remote = r;
    const saved = await recallKey();
    if (isCancelled()) return;
    // Trust the remembered KDF parameters, not the server's, and only for the vault they were made for.
    if (saved && saved.kdf.salt === r.envelope.kdf.salt && saved.kdf.iterations === r.envelope.kdf.iterations) {
      try {
        await openWith(saved.key, saved.kdf);
        ui.setRemembered(true);
        return;
      } catch {
        // The remembered key no longer opens it: ask for the passphrase.
      }
    }
    if (saved) await forgetKeyFor(saved.kdf.salt);
    ui.setStatus(saved ? { s: "locked", reason: PASSPHRASE_CHANGED } : { s: "locked" });
  }

  /** Back on the tab: save anything stuck, else pick up what another device saved. Leaving it: save at once. */
  async function onVisibility() {
    if (document.visibilityState === "hidden") {
      if (pending.length && key) void flush();
      return;
    }
    if (pending.length && key) {
      void flush();
      return;
    }
    if (!key || inflight) return;
    const at = version;
    try {
      const r = await getRemote();
      if (version !== at || inflight || pending.length || !key) return; // this tab saved meanwhile
      if (!r) {
        goneElsewhere();
        return;
      }
      if (r.envelope.kdf.salt !== kdf?.salt) {
        remote = r;
        lockWith(PASSPHRASE_CHANGED);
        return;
      }
      if (r.version <= version) return;
      const d = fromPlaintext(await open(key, r.envelope));
      if (version !== at || inflight || pending.length) return; // edited meanwhile: the next save rebases instead
      remote = r;
      version = r.version;
      show(d);
      setSave({ state: "idle", at: r.updatedAt });
    } catch (e) {
      // Offline: keep showing what we have. Login expired: say so now, before any edits.
      if (e instanceof SignIn) setSave({ state: "error", at: saveState.at, kind: "signin", error: saveError(e) });
      return;
    } finally {
      if (key && !pending.length) void pullInbox();
    }
  }

  function onOnline() {
    if (pending.length && key) void flush();
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (pending.length || inflight || (legacy && legacyFromPage)) e.preventDefault();
  }

  return {
    start() {
      let cancelled = false;
      void load(() => cancelled);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      window.addEventListener("beforeunload", onBeforeUnload);
      // While the page is open and visible, pick up new phone payments every minute.
      const poll = setInterval(() => {
        if (document.visibilityState === "visible" && key && !pending.length && !inflight) void pullInbox();
      }, PHONE_POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(poll);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
    },

    apply: applyEdits,

    /**
     * Connect the phone (or issue a new phone key): make sure the vault holds
     * drop-box keys (saved before the public half is published, so nothing is
     * ever sealed to a key the vault lacks), then register the public key and
     * the new phone key's hash. Returns the phone key, shown to the owner once.
     */
    async connectPhone(): Promise<string> {
      if (!key) throw new Error("Unlock first.");
      let keys = data.phone;
      if (!keys) {
        keys = { ...(await newInboxKeys()), connectedAt: new Date().toISOString() };
        applyEdits({ t: "phone", keys });
        await flush();
        if (pending.length) throw new Error("Couldn't save the phone's drop-box key yet. Try again in a moment.");
      }
      const token = newPhoneToken();
      const res = await api("PUT", { publicJwk: keys.publicJwk, tokenHash: await sha256Hex(token) }, "/inbox");
      setPhone({ ...phone, connected: true, connectedAt: res.connectedAt as string });
      return token;
    },

    /** Stop accepting the phone key, delete what's waiting, and drop the drop-box keys. */
    async disconnectPhone() {
      await api("DELETE", undefined, "/inbox?disconnect=phone");
      applyEdits({ t: "phone", keys: null });
      await flush();
      setPhone({ connected: false, unreadable: [] });
    },

    async dismissNote(id: string) {
      await api("DELETE", { ids: [id] }, "/inbox");
      setPhone({ ...phone, unreadable: phone.unreadable.filter((u) => u.id !== id) });
    },

    checkPhone: () => pullInbox(),

    async unlock(passphrase: string, rememberDevice: boolean) {
      // Fetch first: the passphrase may have been changed on another device since this page loaded.
      try {
        const fresh = await getRemote();
        if (!fresh) {
          goneElsewhere();
          return;
        }
        remote = fresh;
      } catch (e) {
        if (!(e instanceof Offline) || !remote) throw e;
      }
      if (!remote) throw new Error("Nothing is saved on the site yet.");
      const params = remote.envelope.kdf;
      const k = await deriveKey(passphrase, params);
      await openWith(k, params);
      await remember(k, params, rememberDevice);
    },

    async setup(passphrase: string, rememberDevice: boolean) {
      const nextKdf = newKdf();
      const k = await deriveKey(passphrase, nextKdf);
      const sent = pending.length;
      const env = await seal(k, nextKdf, toPlaintext(data, new Date().toISOString()));
      tooBig(env);
      let res: Record<string, unknown>;
      try {
        res = await api("PUT", { baseVersion: 0, envelope: env });
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        // Another device saved first: unlock that vault; what's on this page is merged in on unlock.
        remote = await getRemote();
        // Kept, and added on unlock (filling gaps); until then leaving the page warns.
        if (data.txns.length || Object.keys(data.overrides).length || !isBlankProfile(data.profile)) {
          legacy = data;
          legacyFromPage = true;
        }
        pending = [];
        ui.setStatus({
          s: "locked",
          reason: "Your data was already saved from another device. Unlock it with that passphrase; what's here will be added.",
        });
        return;
      }
      key = k;
      kdf = nextKdf;
      accept(env, res);
      ack(sent);
      clearLegacy();
      legacy = null;
      await remember(k, nextKdf, rememberDevice);
      ui.setStatus({ s: "unlocked" });
      if (pending.length) schedule();
    },

    async changePassphrase(passphrase: string, rememberDevice: boolean) {
      if (!key) throw new Error("Unlock first.");
      await flush();
      if (pending.length) throw new Error("Your latest changes aren't saved yet. Try again in a moment.");
      // Inside the single flight, so no save can run between sealing under the new key and switching to it.
      const run = (async () => {
        const nextKdf = newKdf();
        const k = await deriveKey(passphrase, nextKdf);
        const env = await seal(k, nextKdf, toPlaintext(data, new Date().toISOString()));
        tooBig(env);
        let res: Record<string, unknown>;
        try {
          res = await api("PUT", { baseVersion: version, envelope: env });
        } catch (e) {
          if (e instanceof Conflict) throw new Error("Your data just changed on another device. Reload the page and try again.");
          throw e;
        }
        key = k;
        kdf = nextKdf;
        accept(env, res);
        await remember(k, nextKdf, rememberDevice);
      })();
      inflight = run.catch(() => undefined);
      try {
        await run;
      } finally {
        inflight = null;
      }
      if (pending.length) schedule();
    },

    /** Forget the key on this device and clear the decrypted data from the page. */
    async lockDevice(discardUnsaved = false) {
      await flush();
      if (pending.length && !discardUnsaved) {
        throw new Error(`${pending.length} change${pending.length === 1 ? " isn't" : "s aren't"} saved yet.`);
      }
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      pending = [];
      firstPendingAt = 0;
      key = null;
      kdf = null;
      // An old unencrypted copy not yet merged (its save failed) mustn't stay readable on a locked device.
      legacy = null;
      clearLegacy();
      await forgetKey();
      ui.setRemembered(false);
      show(EMPTY_DATA);
      ui.setNotice(null);
      setSave({ state: "idle" });
      ui.setStatus({ s: "locked" });
    },

    /** Delete the vault (and its history) from the site, and everything this device holds. */
    async deleteEverything() {
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      while (inflight) await inflight;
      try {
        await api("DELETE", undefined, "?confirm=everything");
      } catch (e) {
        if (e instanceof Offline) throw new Error("You're offline, so nothing was deleted. Try again when you're back online.");
        if (e instanceof SignIn) throw new Error("Your sign-in has expired, so nothing was deleted. Reload the page to sign in again.");
        throw e;
      }
      key = null;
      kdf = null;
      version = 0;
      remote = null;
      pending = [];
      firstPendingAt = 0;
      legacy = null;
      await forgetKey();
      clearLegacy();
      ui.setRemembered(false);
      show(EMPTY_DATA);
      setSave({ state: "idle" });
      setPhone({ connected: false, unreadable: [] });
      ui.setNotice(null);
      ui.setStatus({ s: "setup" });
    },

    /** Before anything is saved: drop what's on this page and this browser's old local copy, saving nothing. */
    discardLocal() {
      if (key) return;
      if (timer) clearTimeout(timer);
      pending = [];
      firstPendingAt = 0;
      legacy = null;
      clearLegacy();
      show(EMPTY_DATA);
      ui.setNotice(null);
    },

    pendingCount: () => pending.length,
    retry: () => void flush(),
  };
}

export function useVault() {
  const [status, setStatus] = useState<VaultStatus>({ s: "loading" });
  const [data, setData] = useState<VaultData>(EMPTY_DATA);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [remembered, setRemembered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneState>({ connected: false, unreadable: [] });
  const [vault] = useState(() => createVault({ setStatus, setData, setSave, setRemembered, setNotice, setPhone }));
  useEffect(() => vault.start(), [vault]);
  return { status, data, save, remembered, notice, phone, ...vault };
}

export const isWrongPassphrase = (e: unknown) => e instanceof WrongPassphraseError;
