import { openForTools } from "@/lib/downloader-auth";
import { FINISHED_STATUSES, deleteJobFiles, json } from "@/lib/downloader";

/** POST → { cleared }: removes every finished job (done, failed, cancelled) and its files. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await openForTools(request, { write: true });
  if ("denied" in gate) return gate.denied;
  const db = gate.env.DL_DB;
  const marks = FINISHED_STATUSES.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id FROM dl_jobs WHERE status IN (${marks})`)
    .bind(...FINISHED_STATUSES)
    .all<{ id: string }>();
  for (const j of results) {
    await deleteJobFiles(db, gate.env.DL_BUCKET, j.id);
    await db.prepare("DELETE FROM dl_jobs WHERE id = ?").bind(j.id).run();
  }
  return json({ cleared: results.length });
}
