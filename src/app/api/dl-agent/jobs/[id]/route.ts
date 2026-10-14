import { openForAgent } from "@/lib/downloader-auth";
import { FINISHED_STATUSES, type JobRow, type JobStatus, json } from "@/lib/downloader";

/**
 * Progress from the agent for one of its jobs.
 *
 *   POST { status?, progress?, message?, title? } → { cancel: boolean }
 *
 * The reply tells the agent whether the owner cancelled (or deleted) the job,
 * so a running download stops within one progress report.
 */
export const dynamic = "force-dynamic";

const AGENT_STATUSES: JobStatus[] = ["downloading", "converting", "uploading", "done", "failed", "cancelled"];

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await openForAgent(request);
  if ("denied" in gate) return gate.denied;
  const { id } = await ctx.params;
  const db = gate.env.DL_DB;
  const job = await db
    .prepare("SELECT * FROM dl_jobs WHERE id = ? AND agent_id = ?")
    .bind(id, gate.agent.id)
    .first<JobRow>();
  if (!job) return json({ cancel: true, error: "not found" }, 404);
  if (FINISHED_STATUSES.includes(job.status)) return json({ cancel: true });

  let body: { status?: unknown; progress?: unknown; message?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const status = AGENT_STATUSES.includes(body.status as JobStatus) ? (body.status as JobStatus) : job.status;
  const progress =
    typeof body.progress === "number" && Number.isFinite(body.progress)
      ? Math.max(0, Math.min(100, body.progress))
      : job.progress;
  const message = typeof body.message === "string" ? body.message.slice(0, 500) : job.message;
  const title = typeof body.title === "string" && body.title ? body.title.slice(0, 300) : job.title;
  const now = Date.now();
  const finished = FINISHED_STATUSES.includes(status);

  await db
    .prepare(
      "UPDATE dl_jobs SET status = ?, progress = ?, message = ?, title = ?, updated_at = ?, finished_at = ? WHERE id = ?",
    )
    .bind(status, progress, message, title, now, finished ? now : null, id)
    .run();
  return json({ cancel: !finished && !!job.cancel_requested });
}
