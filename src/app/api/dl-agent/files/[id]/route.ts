import { openForAgent } from "@/lib/downloader-auth";
import { PART_SIZE, type FileRow, json } from "@/lib/downloader";

/**
 * One file's multipart upload, from the agent.
 *
 *   PUT ?part=N  (body: the part's bytes) → { partNumber, etag }
 *   POST { parts: [{ partNumber, etag }] } → { ok, size }   completes it
 *   DELETE → { ok }                                          aborts it
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function openFile(request: Request, ctx: Ctx) {
  const gate = await openForAgent(request);
  if ("denied" in gate) return gate;
  const { id } = await ctx.params;
  // Only the agent that owns the job may touch its files.
  const file = await gate.env.DL_DB
    .prepare(
      `SELECT f.* FROM dl_files f JOIN dl_jobs j ON j.id = f.job_id
       WHERE f.id = ? AND j.agent_id = ? AND f.complete = 0 AND f.upload_id IS NOT NULL`,
    )
    .bind(id, gate.agent.id)
    .first<FileRow>();
  if (!file) return { denied: json({ error: "upload not found" }, 404) };
  return { ...gate, file, upload: gate.env.DL_BUCKET.resumeMultipartUpload(file.r2_key, file.upload_id!) };
}

export async function PUT(request: Request, ctx: Ctx) {
  const o = await openFile(request, ctx);
  if ("denied" in o) return o.denied;
  const part = Number(new URL(request.url).searchParams.get("part"));
  if (!Number.isInteger(part) || part < 1 || part > 10000) return json({ error: "bad part number" }, 400);
  // Buffered rather than streamed so R2 always gets a known length.
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > PART_SIZE) return json({ error: "bad part size" }, 400);
  // A short read would only surface later as a failed completion; catch it here so the agent retries the part.
  const declared = Number(request.headers.get("content-length"));
  if (declared && bytes.byteLength !== declared) return json({ error: "part arrived incomplete" }, 400);
  const uploaded = await o.upload.uploadPart(part, bytes);
  return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
}

export async function POST(request: Request, ctx: Ctx) {
  const o = await openFile(request, ctx);
  if ("denied" in o) return o.denied;
  let body: { parts?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const parts = (Array.isArray(body.parts) ? body.parts : [])
    .map((p) => ({ partNumber: Number(p?.partNumber), etag: String(p?.etag ?? "") }))
    .filter((p) => Number.isInteger(p.partNumber) && p.etag)
    .sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length === 0) return json({ error: "no parts" }, 400);
  const obj = await o.upload.complete(parts);
  await o.env.DL_DB
    .prepare("UPDATE dl_files SET complete = 1, upload_id = NULL, size = ? WHERE id = ?")
    .bind(obj.size, o.file.id)
    .run();
  return json({ ok: true, size: obj.size });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const o = await openFile(request, ctx);
  if ("denied" in o) return o.denied;
  try {
    await o.upload.abort();
  } catch {}
  await o.env.DL_DB.prepare("DELETE FROM dl_files WHERE id = ?").bind(o.file.id).run();
  return json({ ok: true });
}
