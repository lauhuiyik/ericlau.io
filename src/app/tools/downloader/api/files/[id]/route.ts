import { openForOwner } from "@/lib/downloader-auth";
import { type FileRow, attachmentHeader, json } from "@/lib/downloader";

/** GET → the finished file, streamed from R2 as a download. */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await openForOwner(request);
  if ("denied" in gate) return gate.denied;
  const { id } = await ctx.params;
  const file = await gate.env.DL_DB
    .prepare("SELECT * FROM dl_files WHERE id = ? AND complete = 1")
    .bind(id)
    .first<FileRow>();
  if (!file) return json({ error: "not found (files are kept for 24 hours)" }, 404);
  const obj = await gate.env.DL_BUCKET.get(file.r2_key);
  if (!obj) return json({ error: "file expired" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": file.content_type,
      "content-length": String(obj.size),
      "content-disposition": attachmentHeader(file.name),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
