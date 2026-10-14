import { openForOwner } from "@/lib/downloader-auth";
import { ACTIVE_STATUSES, json, newAgentKey, newId, sha256Hex } from "@/lib/downloader";

/**
 *   POST { name } → { id, key }   A connection key for a home PC. Shown once;
 *                                  only its SHA-256 is stored.
 *   DELETE ?id=…  → { ok }        Disconnects that PC (its key stops working).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await openForOwner(request, { write: true });
  if ("denied" in gate) return gate.denied;
  let body: { name?: unknown } = {};
  try {
    body = await request.json();
  } catch {}
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 60) || "Home PC";
  const key = newAgentKey();
  const id = newId();
  await gate.env.DL_DB
    .prepare("INSERT INTO dl_agents (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, await sha256Hex(key), Date.now())
    .run();
  return json({ id, key });
}

export async function DELETE(request: Request) {
  const gate = await openForOwner(request, { write: true });
  if ("denied" in gate) return gate.denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const db = gate.env.DL_DB;
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM dl_agents WHERE id = ?").bind(id),
    db
      .prepare(
        `UPDATE dl_jobs SET status = 'failed', message = 'PC was disconnected', finished_at = ?, updated_at = ?
         WHERE agent_id = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`,
      )
      .bind(now, now, id, ...ACTIVE_STATUSES),
  ]);
  return json({ ok: true });
}
