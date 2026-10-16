import { MAX_CT_CHARS, parseEnvelope } from "@/lib/vault-envelope";
import { crossSite, json, ownerDb as open } from "./guard";

/**
 * The owner's encrypted finance vault (one row in D1 database ericlau-finance).
 *
 *   GET    → { exists: false } | { exists: true, version, envelope, updatedAt }
 *   PUT    { baseVersion, envelope } → { version, updatedAt } | 409 { version }
 *   DELETE ?confirm=everything → { deleted: true }
 *
 * The server never sees the passphrase or plaintext: the browser encrypts
 * (src/lib/vault-crypto.ts) and this route only validates and stores the
 * envelope. Saves are compare-and-swap on `version`, so two devices can't
 * silently overwrite each other; the client replays its edits on a 409. A new
 * vault starts at the current time in ms, so versions are never reused after
 * "delete everything" and a stale device can't match a newer vault.
 *
 * History keeps the replaced envelopes (the last 30, plus the newest of each
 * of the last 60 days) for recovery by hand, and only ever under the current
 * passphrase: changing it deletes the copies the old one could open.
 *
 * Access covers every method on this path, and each request is checked again
 * here: a valid Access token AND the owner's email (src/lib/finance-auth.ts).
 */
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = MAX_CT_CHARS + 4096;
const HISTORY_KEPT = 30;
const HISTORY_DAYS = 60;

type Row = { version: number; envelope: string; updated_at: string };

async function currentVersion(db: D1Database) {
  const row = await db.prepare("SELECT version FROM vault WHERE id = 'main'").first<{ version: number }>();
  return row?.version ?? 0;
}

export async function GET(request: Request) {
  const ctx = await open(request);
  if ("denied" in ctx) return ctx.denied;
  const row = await ctx.db.prepare("SELECT version, envelope, updated_at FROM vault WHERE id = 'main'").first<Row>();
  if (!row) return json({ exists: false });
  return json({ exists: true, version: row.version, envelope: JSON.parse(row.envelope), updatedAt: row.updated_at });
}

export async function PUT(request: Request) {
  const ctx = await open(request);
  if ("denied" in ctx) return ctx.denied;
  const bad = crossSite(request);
  if (bad) return json({ error: bad }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "expected application/json" }, 415);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return json({ error: "vault too large" }, 413);
  let body: { baseVersion?: unknown; envelope?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  const base = body?.baseVersion;
  if (typeof base !== "number" || !Number.isSafeInteger(base) || base < 0) return json({ error: "bad baseVersion" }, 400);
  const parsed = parseEnvelope(body.envelope);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const db = ctx.db;
  const stored = JSON.stringify(parsed.envelope);
  const now = new Date().toISOString();
  if (base === 0) {
    const start = Date.now();
    const res = await db
      .prepare("INSERT INTO vault (id, version, envelope, updated_at) VALUES ('main', ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(start, stored, now)
      .run();
    if (res.meta.changes !== 1) return json({ error: "conflict", version: await currentVersion(db) }, 409);
    return json({ version: start, updatedAt: now });
  }
  const keepSince = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  // One transaction: keep the version being replaced, swap only if nobody saved since `base`, trim history.
  const [, updated] = await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO vault_history (id, version, envelope, updated_at) SELECT id, version, envelope, updated_at FROM vault WHERE id = 'main' AND version = ?",
      )
      .bind(base),
    db
      .prepare("UPDATE vault SET version = version + 1, envelope = ?, updated_at = ? WHERE id = 'main' AND version = ?")
      .bind(stored, now, base),
    // Only envelopes under the current passphrase (after a change, the old one's copies go).
    db.prepare(
      "DELETE FROM vault_history WHERE id = 'main' AND json_extract(envelope, '$.kdf.salt') IS NOT (SELECT json_extract(envelope, '$.kdf.salt') FROM vault WHERE id = 'main')",
    ),
    // The last 30 versions, plus the newest of each of the last 60 days.
    db
      .prepare(
        "DELETE FROM vault_history WHERE id = 'main' AND version <= ? AND version NOT IN (SELECT MAX(version) FROM vault_history WHERE id = 'main' AND updated_at >= ? GROUP BY substr(updated_at, 1, 10))",
      )
      .bind(base - HISTORY_KEPT, keepSince),
  ]);
  if (updated.meta.changes !== 1) return json({ error: "conflict", version: await currentVersion(db) }, 409);
  return json({ version: base + 1, updatedAt: now });
}

export async function DELETE(request: Request) {
  const ctx = await open(request);
  if ("denied" in ctx) return ctx.denied;
  const bad = crossSite(request);
  if (bad) return json({ error: bad }, 403);
  if (new URL(request.url).searchParams.get("confirm") !== "everything") return json({ error: "add ?confirm=everything" }, 400);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM vault WHERE id = 'main'"),
    ctx.db.prepare("DELETE FROM vault_history WHERE id = 'main'"),
    // The phone feed too: its key could only be opened by the vault just deleted.
    ctx.db.prepare("DELETE FROM inbox_key"),
    ctx.db.prepare("DELETE FROM inbox"),
  ]);
  return json({ deleted: true });
}
