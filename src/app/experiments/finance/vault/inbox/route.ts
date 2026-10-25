import { isPublicKeyJwk } from "@/lib/vault-inbox";
import { crossSite, json, ownerDb } from "../guard";

/**
 * The owner's side of the phone feed (the phone posts to /api/finance/notify).
 *
 *   GET    → { connected, connectedAt?, entries: [{ id, receivedAt, envelope }], more }
 *   PUT    { publicJwk, tokenHash } → connect, or issue a new phone key
 *   DELETE { ids: [...] } → remove filed entries; ?disconnect=phone → remove the key and every entry
 *
 * Entries are encrypted to the vault's drop-box public key; only the unlocked
 * page (which holds the private key inside the vault) can read them.
 */
export const dynamic = "force-dynamic";

const PAGE = 500;
const ID = /^[0-9a-f-]{36}$/;

export async function GET(request: Request) {
  const ctx = await ownerDb(request);
  if ("denied" in ctx) return ctx.denied;
  const key = await ctx.db.prepare("SELECT updated_at FROM inbox_key WHERE id = 'main'").first<{ updated_at: string }>();
  const { results } = await ctx.db
    .prepare("SELECT id, received_at, envelope FROM inbox ORDER BY received_at LIMIT ?")
    .bind(PAGE + 1)
    .all<{ id: string; received_at: string; envelope: string }>();
  return json({
    connected: !!key,
    connectedAt: key?.updated_at,
    entries: results.slice(0, PAGE).map((r) => ({ id: r.id, receivedAt: r.received_at, envelope: JSON.parse(r.envelope) })),
    more: results.length > PAGE,
  });
}

export async function PUT(request: Request) {
  const ctx = await ownerDb(request);
  if ("denied" in ctx) return ctx.denied;
  const bad = crossSite(request);
  if (bad) return json({ error: bad }, 403);
  let body: { publicJwk?: unknown; tokenHash?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  if (!isPublicKeyJwk(body.publicJwk)) return json({ error: "bad public key" }, 400);
  if (typeof body.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(body.tokenHash)) return json({ error: "bad token hash" }, 400);
  const { kty, crv, x, y } = body.publicJwk;
  const now = new Date().toISOString();
  await ctx.db
    .prepare(
      "INSERT INTO inbox_key (id, public_jwk, token_hash, updated_at) VALUES ('main', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET public_jwk = excluded.public_jwk, token_hash = excluded.token_hash, updated_at = excluded.updated_at",
    )
    .bind(JSON.stringify({ kty, crv, x, y }), body.tokenHash, now)
    .run();
  return json({ connected: true, connectedAt: now });
}

export async function DELETE(request: Request) {
  const ctx = await ownerDb(request);
  if ("denied" in ctx) return ctx.denied;
  const bad = crossSite(request);
  if (bad) return json({ error: bad }, 403);
  const q = new URL(request.url).searchParams;
  if (q.get("disconnect") === "phone") {
    await ctx.db.batch([ctx.db.prepare("DELETE FROM inbox_key"), ctx.db.prepare("DELETE FROM inbox")]);
    return json({ connected: false });
  }
  // In the body: up to 500 ids would be too long for a URL.
  let ids: unknown;
  try {
    ids = (JSON.parse(await request.text()) as { ids?: unknown }).ids;
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  if (!Array.isArray(ids) || !ids.length || ids.length > PAGE || !ids.every((id) => typeof id === "string" && ID.test(id))) {
    return json({ error: "bad ids" }, 400);
  }
  await ctx.db.batch((ids as string[]).map((id) => ctx.db.prepare("DELETE FROM inbox WHERE id = ?").bind(id)));
  return json({ deleted: ids.length });
}
