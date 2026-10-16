import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseNoteBody } from "@/lib/phone-feed";
import { sameDigest, sealToInbox, sha256Hex } from "@/lib/vault-inbox";

/**
 * Where the owner's phone forwards payment notifications (MacroDroid's HTTP
 * Request action): POST with `Authorization: Bearer <phone key>` and a short
 * plain-text (or JSON) body with the notification's app, title and text.
 *
 * Not behind Cloudflare Access (the phone can't log in): the phone key is the
 * credential, and it can only ADD to the drop box. Each note is encrypted to
 * the vault's drop-box public key before it is stored, so nothing readable is
 * kept; only the owner's unlocked page can open it. Bodies are never logged.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 4096;
const MAX_QUEUED = 2000;
const clip = (s: string | undefined, n: number) => (s ?? "").slice(0, n);
const reply = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})\s*$/)?.[1];
  if (!token) return reply(401, { error: "missing phone key" });
  const { env } = await getCloudflareContext({ async: true });
  const db = env.FINANCE_DB;
  const key = await db
    .prepare("SELECT public_jwk, token_hash FROM inbox_key WHERE id = 'main'")
    .first<{ public_jwk: string; token_hash: string }>();
  if (!key || !sameDigest(await sha256Hex(token), key.token_hash)) return reply(401, { error: "wrong phone key" });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "too long" });
  const note = parseNoteBody(raw);
  if (!note) return reply(400, { error: "expected app=, title= and text= lines" });

  const queued = await db.prepare("SELECT COUNT(*) AS n FROM inbox").first<{ n: number }>();
  if ((queued?.n ?? 0) >= MAX_QUEUED) return reply(429, { error: "drop box full: open the finance page to file what's waiting" });

  const receivedAt = new Date().toISOString();
  const sealed = await sealToInbox(JSON.parse(key.public_jwk), {
    app: clip(note.app, 120),
    title: clip(note.title, 500),
    text: clip(note.text, 2000),
    postedAt: clip(note.postedAt, 40),
    receivedAt,
  });
  await db
    .prepare("INSERT INTO inbox (id, received_at, envelope) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), receivedAt, JSON.stringify(sealed))
    .run();
  return reply(202, { ok: true });
}
