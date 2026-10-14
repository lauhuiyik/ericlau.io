/**
 * "Remember on this device": keeps the vault key in IndexedDB so the owner
 * doesn't retype the passphrase on every visit. The key is a non-extractable
 * CryptoKey: code on this site can use it but never read its bytes. Stored
 * with the KDF parameters it was derived with: when the passphrase is changed
 * on another device the salt no longer matches and the key is dropped, and
 * the remembered parameters (not the server's) are what the page trusts.
 *
 * Every call swallows storage errors (private browsing, blocked storage): the
 * page then simply asks for the passphrase each visit.
 */

import type { VaultKdf } from "./vault-envelope";

const DB_NAME = "finance-vault";
const STORE = "keys";
const ID = "main";

type Remembered = { key: CryptoKey; kdf: VaultKdf };

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}

export async function rememberKey(key: CryptoKey, kdf: VaultKdf): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put({ key, kdf } satisfies Remembered, ID));
    // Ask the browser not to evict it under storage pressure (Chromium, Firefox). Safari may
    // still clear it after weeks without a visit; the passphrase then opens the data again.
    void navigator.storage?.persist?.().catch(() => false);
    return true;
  } catch {
    return false;
  }
}

export async function recallKey(): Promise<Remembered | null> {
  try {
    const v = (await run("readonly", (s) => s.get(ID))) as Remembered | undefined;
    return v && v.key instanceof CryptoKey && v.kdf && typeof v.kdf.salt === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Forget the remembered key only if it was made for `salt`. A stale tab must not
 * delete a newer key another tab just remembered after a passphrase change.
 */
export async function forgetKeyFor(salt: string): Promise<void> {
  try {
    const d = await db();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.get(ID);
        req.onsuccess = () => {
          if ((req.result as Remembered | undefined)?.kdf?.salt === salt) store.delete(ID);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      d.close();
    }
  } catch {
    // Storage blocked: nothing to forget.
  }
}

export async function forgetKey(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(ID));
  } catch {
    // Nothing stored, or storage blocked: nothing to forget.
  }
}
