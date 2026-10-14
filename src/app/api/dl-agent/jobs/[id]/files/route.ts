import { openForAgent } from "@/lib/downloader-auth";
import { FINISHED_STATUSES, MAX_FILE_BYTES, PART_SIZE, type JobRow, contentTypeFor, json, newId } from "@/lib/downloader";

/**
 * Starts uploading one finished file for a job (R2 multipart upload).
 *
 *   POST { name, size } → { fileId, partSize }
 *
 * The agent then PUTs each part to /api/dl-agent/files/<fileId>?part=N and
 * completes it with a POST there.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await openForAgent(request);
  if ("denied" in gate) return gate.denied;
  const { id } = await ctx.params;
  const db = gate.env.DL_DB;
  const job = await db
    .prepare("SELECT * FROM dl_jobs WHERE id = ? AND agent_id = ?")
    .bind(id, gate.agent.id)
    .first<JobRow>();
  if (!job || FINISHED_STATUSES.includes(job.status)) return json({ error: "job not active" }, 404);

  let body: { name?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  // Keep only a plain file name: no folders, no control characters.
  const name = (typeof body.name === "string" ? body.name : "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 200);
  const size = Number(body.size);
  if (!name) return json({ error: "missing name" }, 400);
  if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) return json({ error: "bad size" }, 400);

  const fileId = newId();
  const key = `jobs/${id}/${fileId}/${name}`;
  const contentType = contentTypeFor(name);
  const upload = await gate.env.DL_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
  await db
    .prepare(
      `INSERT INTO dl_files (id, job_id, name, r2_key, size, content_type, upload_id, complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(fileId, id, name, key, size, contentType, upload.uploadId, Date.now())
    .run();
  return json({ fileId, partSize: PART_SIZE });
}
