import { openForTools } from "@/lib/downloader-auth";
import { FINISHED_STATUSES, type JobRow, deleteJobFiles, json } from "@/lib/downloader";

/**
 *   POST { action: "cancel" | "retry" } → { ok }
 *   DELETE → { ok }   (removes the job and its files)
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await openForTools(request, { write: true });
  if ("denied" in gate) return gate.denied;
  const { id } = await ctx.params;
  const db = gate.env.DL_DB;
  const job = await db.prepare("SELECT * FROM dl_jobs WHERE id = ?").bind(id).first<JobRow>();
  if (!job) return json({ error: "not found" }, 404);

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const now = Date.now();

  if (body.action === "cancel") {
    if (job.status === "queued") {
      await db
        .prepare("UPDATE dl_jobs SET status = 'cancelled', message = '', finished_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, id)
        .run();
    } else if (!FINISHED_STATUSES.includes(job.status)) {
      // The agent sees this on its next poll or progress report and stops the job.
      await db
        .prepare("UPDATE dl_jobs SET cancel_requested = 1, message = 'Cancelling…', updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    }
    return json({ ok: true });
  }

  if (body.action === "retry") {
    if (!FINISHED_STATUSES.includes(job.status)) return json({ error: "job is still running" }, 409);
    await deleteJobFiles(db, gate.env.DL_BUCKET, id);
    await db
      .prepare(
        `UPDATE dl_jobs SET status = 'queued', progress = 0, message = '', title = '', cancel_requested = 0, agent_id = NULL,
         finished_at = NULL, created_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(now, now, id)
      .run();
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await openForTools(request, { write: true });
  if ("denied" in gate) return gate.denied;
  const { id } = await ctx.params;
  const db = gate.env.DL_DB;
  // If the PC is still working on it, its next report gets a 404 and it stops.
  await deleteJobFiles(db, gate.env.DL_BUCKET, id);
  await db.prepare("DELETE FROM dl_jobs WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
