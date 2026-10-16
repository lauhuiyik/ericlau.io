import { ringDownloader } from "@/lib/doorbell";
import { openForTools } from "@/lib/downloader-auth";
import {
  COOKIE_BROWSERS,
  FILE_TTL_MS,
  type AgentRow,
  type FileRow,
  type JobRow,
  agentState,
  hasDoorbell,
  json,
  markUiSeen,
  newId,
  sweep,
} from "@/lib/downloader";

/**
 *   GET  → { jobs: [...job, files], agents, now }   (the page polls this)
 *   POST { urls: string[], mode, cookiesBrowser } → { created }
 */
export const dynamic = "force-dynamic";

const MAX_URLS = 50;

export async function GET(request: Request) {
  const ctx = await openForTools(request);
  if ("denied" in ctx) return ctx.denied;
  const db = ctx.env.DL_DB;
  const now = Date.now();
  await markUiSeen(db, ctx.env.MEDIA_BUCKET, now);
  await sweep(db, ctx.env.DL_BUCKET, now);

  const { results: jobs } = await db
    .prepare("SELECT * FROM dl_jobs ORDER BY created_at DESC LIMIT 100")
    .all<JobRow>();
  const { results: files } = await db
    .prepare("SELECT id, job_id, name, size, created_at FROM dl_files WHERE complete = 1 ORDER BY name")
    .all<Pick<FileRow, "id" | "job_id" | "name" | "size" | "created_at">>();
  const { results: agents } = await db
    .prepare("SELECT id, name, created_at, last_seen, info FROM dl_agents ORDER BY created_at")
    .all<Omit<AgentRow, "key_hash">>();

  const filesByJob = new Map<string, { id: string; name: string; size: number; expiresAt: number }[]>();
  for (const f of files) {
    const list = filesByJob.get(f.job_id) ?? [];
    list.push({ id: f.id, name: f.name, size: f.size, expiresAt: f.created_at + FILE_TTL_MS });
    filesByJob.set(f.job_id, list);
  }

  return json({
    now,
    jobs: jobs.map((j) => ({
      id: j.id,
      url: j.url,
      mode: j.mode,
      cookiesBrowser: j.cookies_browser,
      status: j.status,
      progress: j.progress,
      message: j.message,
      title: j.title,
      cancelRequested: !!j.cancel_requested,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
      files: filesByJob.get(j.id) ?? [],
    })),
    agents: agents.map((a) => {
      let info: Record<string, unknown> = {};
      try {
        info = JSON.parse(a.info);
      } catch {}
      const state = agentState(a.last_seen, hasDoorbell(info), now);
      return {
        id: a.id,
        name: a.name,
        createdAt: a.created_at,
        lastSeen: a.last_seen,
        // Standby counts as online: a doorbell agent wakes within ~15 s of a new link.
        online: state !== "offline",
        state,
        info,
      };
    }),
  });
}

export async function POST(request: Request) {
  const ctx = await openForTools(request, { write: true });
  if ("denied" in ctx) return ctx.denied;

  let body: { urls?: unknown; mode?: unknown; cookiesBrowser?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected JSON" }, 400);
  }
  const mode = body.mode === "mp3" ? "mp3" : body.mode === "video" ? "video" : null;
  if (!mode) return json({ error: "mode must be video or mp3" }, 400);
  const cookies = typeof body.cookiesBrowser === "string" ? body.cookiesBrowser : "";
  if (!(COOKIE_BROWSERS as readonly string[]).includes(cookies)) return json({ error: "unknown browser" }, 400);

  const urls = (Array.isArray(body.urls) ? body.urls : [])
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => {
      if (u.length > 2048) return false;
      try {
        const p = new URL(u);
        return p.protocol === "https:" || p.protocol === "http:";
      } catch {
        return false;
      }
    });
  if (urls.length === 0) return json({ error: "no valid http(s) links" }, 400);
  if (urls.length > MAX_URLS) return json({ error: `at most ${MAX_URLS} links at once` }, 400);

  const db = ctx.env.DL_DB;
  const now = Date.now();
  await db.batch(
    urls.map((url, i) =>
      db
        .prepare(
          "INSERT INTO dl_jobs (id, url, mode, cookies_browser, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
        )
        // +i keeps the paste order when several land in the same millisecond.
        .bind(newId(), url, mode, cookies, now + i, now + i),
    ),
  );
  await ringDownloader(ctx.env.MEDIA_BUCKET, now);
  await markUiSeen(db, ctx.env.MEDIA_BUCKET, now);
  return json({ created: urls.length });
}
