"use client";

import { useEffect, useState } from "react";
import { MAX_CT_CHARS, type VaultEnvelope, type VaultKdf, parseEnvelope } from "@/lib/vault-envelope";
import { WrongPassphraseError, deriveKey, newKdf, open, seal } from "@/lib/vault-crypto";
import { forgetKey, forgetKeyFor, recallKey, rememberKey } from "@/lib/vault-device";
import {
  EMPTY_DATA,
  type VaultData,
  type VaultOp,
  applyOp,
  applyOps,
  fromPlaintext,
  isBlankProfile,
  legacyOps,
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

  const setSave = (s: SaveState) => {
    saveState = s;
    ui.setSave(s);
  };
  const show = (d: VaultData) => {
    data = d;
    ui.setData(d);
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
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
    },

    /** Apply edits now and queue what actually changed for the next save. */
    apply(ops: VaultOp | VaultOp[]) {
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
    },

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
  const [vault] = useState(() => createVault({ setStatus, setData, setSave, setRemembered, setNotice }));
  useEffect(() => vault.start(), [vault]);
  return { status, data, save, remembered, notice, ...vault };
}

export const isWrongPassphrase = (e: unknown) => e instanceof WrongPassphraseError;
