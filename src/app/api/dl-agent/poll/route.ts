import { openForAgent } from "@/lib/downloader-auth";
import { ACTIVE_STATUSES, type JobRow, json, nextPollMs, sweep } from "@/lib/downloader";

/**
 * The home-PC agent's heartbeat (downloader/agent/dl_agent.py).
 *
 *   POST { running: string[], freeSlots: number, info: {...} }
 *     → { jobs: [claimed jobs], cancel: [job ids to stop], nextPollMs }
 *
 * Outside Cloudflare Access (the agent can't log in); authenticated by the
 * PC's connection key. Jobs this PC had claimed but no longer reports as
 * running were lost (agent restarted, PC rebooted) and are failed here.
 */
export const dynamic = "force-dynamic";

const MAX_CLAIM = 4;

export async function POST(request: Request) {
  const ctx = await openForAgent(request);
  if ("denied" in ctx) return ctx.denied;
  const { env, agent } = ctx;
  const db = env.DL_DB;

  let body: { running?: unknown; freeSlots?: unknown; info?: unknown } = {};
  try {
    body = await request.json();
  } catch {}
  const running = (Array.isArray(body.running) ? body.running : []).filter(
    (x): x is string => typeof x === "string",
  );
  const freeSlots = Math.max(0, Math.min(MAX_CLAIM, Number(body.freeSlots) || 0));
  const info = body.info && typeof body.info === "object" ? JSON.stringify(body.info).slice(0, 2000) : agent.info;
  const now = Date.now();

  await db.prepare("UPDATE dl_agents SET last_seen = ?, info = ? WHERE id = ?").bind(now, info, agent.id).run();
  await sweep(db, env.DL_BUCKET, now);

  // This agent's active jobs that it no longer knows about.
  const { results: mine } = await db
    .prepare(
      `SELECT id, status, cancel_requested FROM dl_jobs WHERE agent_id = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`,
    )
    .bind(agent.id, ...ACTIVE_STATUSES)
    .all<{ id: string; status: string; cancel_requested: number }>();
  const lost = mine.filter((j) => !running.includes(j.id));
  for (const j of lost) {
    if (j.status === "starting" && !j.cancel_requested) {
      // Claimed but never started (the claiming reply was lost): hand it out again.
      await db
        .prepare("UPDATE dl_jobs SET status = 'queued', agent_id = NULL, message = '', updated_at = ? WHERE id = ?")
        .bind(now, j.id)
        .run();
      continue;
    }
    await db
      .prepare(
        "UPDATE dl_jobs SET status = ?, message = ?, finished_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        j.cancel_requested ? "cancelled" : "failed",
        j.cancel_requested ? "" : "Interrupted: the PC agent restarted",
        now,
        now,
        j.id,
      )
      .run();
  }
  const cancel = mine.filter((j) => j.cancel_requested && running.includes(j.id)).map((j) => j.id);
  // Running jobs the page deleted outright: stop them too.
  const known = new Set(mine.map((j) => j.id));
  for (const id of running) if (!known.has(id)) cancel.push(id);

  let jobs: JobRow[] = [];
  if (freeSlots > 0) {
    const claimed = await db
      .prepare(
        `UPDATE dl_jobs SET status = 'starting', agent_id = ?, message = 'Starting on the PC…', updated_at = ?
         WHERE id IN (SELECT id FROM dl_jobs WHERE status = 'queued' ORDER BY created_at LIMIT ?)
         RETURNING *`,
      )
      .bind(agent.id, now, freeSlots)
      .all<JobRow>();
    jobs = claimed.results.sort((a, b) => a.created_at - b.created_at);
  }

  return json({
    jobs: jobs.map((j) => ({ id: j.id, url: j.url, mode: j.mode, cookiesBrowser: j.cookies_browser })),
    cancel,
    nextPollMs: await nextPollMs(db, now),
  });
}
