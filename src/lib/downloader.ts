/**
 * Shared pieces of /tools/downloader.
 *
 * The page (behind Cloudflare Access) queues jobs in D1 (DL_DB). A small agent
 * on the owner's home PC (downloader/agent/dl_agent.py) polls /api/dl-agent/*,
 * claims jobs, runs yt-dlp + ffmpeg on the home connection — which YouTube and
 * Instagram don't block the way they block cloud IPs — and uploads the
 * results to R2 (DL_BUCKET). Files are swept after FILE_TTL_MS.
 *
 * The agent can't pass the Access login, so /api/dl-agent/* sits outside it
 * and authenticates with a per-PC connection key instead. Keys are minted on
 * the gated page and only their SHA-256 is stored.
 */

export type JobStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "converting"
  | "uploading"
  | "done"
  | "failed"
  | "cancelled";

export type JobRow = {
  id: string;
  url: string;
  mode: "video" | "mp3";
  cookies_browser: string;
  status: JobStatus;
  progress: number;
  message: string;
  title: string;
  cancel_requested: number;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
};

export type FileRow = {
  id: string;
  job_id: string;
  name: string;
  r2_key: string;
  size: number;
  content_type: string;
  upload_id: string | null;
  complete: number;
  created_at: number;
};

export type AgentRow = {
  id: string;
  name: string;
  key_hash: string;
  created_at: number;
  last_seen: number | null;
  info: string;
};

export const ACTIVE_STATUSES: JobStatus[] = ["starting", "downloading", "converting", "uploading"];
export const FINISHED_STATUSES: JobStatus[] = ["done", "failed", "cancelled"];

/** Finished files are deleted from R2 this long after upload. */
export const FILE_TTL_MS = 24 * 60 * 60 * 1000;
/** Finished jobs (and their history rows) are dropped after this. */
export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Multipart part size the agent uploads in. R2 needs ≥5 MiB parts, and it
 * must stay under 10 MB: with a middleware/proxy present, Next.js buffers
 * request bodies and silently truncates them at proxyClientMaxBodySize
 * (default 10 MB) — 16 MiB parts arrived as ~10 MB and R2 refused to
 * assemble them.
 */
export const PART_SIZE = 8 * 1024 * 1024;
/** Largest single file the agent may upload. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
/** An agent that hasn't polled for this long is shown as offline. */
export const AGENT_ONLINE_MS = 45_000;
/** Agent poll interval while the page is open or work is pending, and when idle. */
export const POLL_FAST_MS = 2_000;
export const POLL_IDLE_MS = 10_000;
/** "Page is open" means it polled within this window. */
const UI_ACTIVE_MS = 3 * 60 * 1000;

/** Browsers yt-dlp can read Instagram login cookies from on Windows ("" = none). */
export const COOKIE_BROWSERS = ["", "firefox", "chrome", "edge", "brave"] as const;

export const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export function newId(bytes = 12): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A fresh connection key for a home PC: "dla_" + 32 random bytes, base64url. */
export function newAgentKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `dla_${b64}`;
}

/** The agent behind an /api/dl-agent/* request, from its `Authorization: Bearer dla_…` key. */
export async function agentFromRequest(request: Request, db: D1Database): Promise<AgentRow | null> {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer (dla_[A-Za-z0-9_-]{20,100})$/.exec(auth);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  return db.prepare("SELECT * FROM dl_agents WHERE key_hash = ?").bind(hash).first<AgentRow>();
}

/**
 * Browser-side writes must come from the downloader page itself: the Access
 * cookie rides along with any request to this origin, so refuse cross-site ones.
 */
export function crossSite(request: Request): string | null {
  if (request.headers.get("x-downloader") !== "1") return "missing x-downloader header";
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "cross-site request";
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return "cross-origin request";
  return null;
}

async function getMeta(db: D1Database, k: string): Promise<string | null> {
  const row = await db.prepare("SELECT v FROM dl_meta WHERE k = ?").bind(k).first<{ v: string }>();
  return row?.v ?? null;
}

async function setMeta(db: D1Database, k: string, v: string) {
  await db
    .prepare("INSERT INTO dl_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
    .bind(k, v)
    .run();
}

/** Record that the page is open (at most one write per 15 s). */
export async function markUiSeen(db: D1Database, now = Date.now()) {
  const last = Number((await getMeta(db, "ui_seen")) ?? 0);
  if (now - last > 15_000) await setMeta(db, "ui_seen", String(now));
}

/** How long the agent should wait before polling again. */
export async function nextPollMs(db: D1Database, now = Date.now()): Promise<number> {
  const uiSeen = Number((await getMeta(db, "ui_seen")) ?? 0);
  if (now - uiSeen < UI_ACTIVE_MS) return POLL_FAST_MS;
  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM dl_jobs WHERE status = 'queued' OR status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`,
    )
    .bind(...ACTIVE_STATUSES)
    .first<{ n: number }>();
  return (pending?.n ?? 0) > 0 ? POLL_FAST_MS : POLL_IDLE_MS;
}

/** Delete a job's files from R2 (finished or half-uploaded) and their rows. */
export async function deleteJobFiles(db: D1Database, bucket: R2Bucket, jobId: string) {
  const { results } = await db.prepare("SELECT * FROM dl_files WHERE job_id = ?").bind(jobId).all<FileRow>();
  for (const f of results) await deleteFileObject(bucket, f);
  await db.prepare("DELETE FROM dl_files WHERE job_id = ?").bind(jobId).run();
}

async function deleteFileObject(bucket: R2Bucket, f: FileRow) {
  try {
    if (f.upload_id && !f.complete) await bucket.resumeMultipartUpload(f.r2_key, f.upload_id).abort();
    else await bucket.delete(f.r2_key);
  } catch {
    // Already gone (or the upload expired): the R2 lifecycle rule is the backstop.
  }
}

/**
 * Housekeeping, at most every 10 minutes: drop files older than FILE_TTL_MS,
 * jobs older than JOB_TTL_MS, and fail jobs whose PC went quiet mid-run.
 */
export async function sweep(db: D1Database, bucket: R2Bucket, now = Date.now()) {
  const last = Number((await getMeta(db, "swept")) ?? 0);
  if (now - last < 10 * 60 * 1000) return;
  await setMeta(db, "swept", String(now));

  const { results: old } = await db
    .prepare("SELECT * FROM dl_files WHERE created_at < ? LIMIT 200")
    .bind(now - FILE_TTL_MS)
    .all<FileRow>();
  for (const f of old) {
    await deleteFileObject(bucket, f);
    await db.prepare("DELETE FROM dl_files WHERE id = ?").bind(f.id).run();
  }

  const { results: stale } = await db
    .prepare("SELECT id FROM dl_jobs WHERE created_at < ? LIMIT 200")
    .bind(now - JOB_TTL_MS)
    .all<{ id: string }>();
  for (const j of stale) {
    await deleteJobFiles(db, bucket, j.id);
    await db.prepare("DELETE FROM dl_jobs WHERE id = ?").bind(j.id).run();
  }

  // A job still "active" after 30 quiet minutes lost its PC (crash, sleep, unplugged).
  await db
    .prepare(
      `UPDATE dl_jobs SET status = 'failed', message = 'Lost contact with the PC', finished_at = ?, updated_at = ?
       WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) AND updated_at < ?`,
    )
    .bind(now, now, ...ACTIVE_STATUSES, now - 30 * 60 * 1000)
    .run();
}

/** Content-Disposition for a download, with an ASCII fallback and the real UTF-8 name. */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function contentTypeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (
    {
      mp4: "video/mp4",
      m4v: "video/mp4",
      mkv: "video/x-matroska",
      webm: "video/webm",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      opus: "audio/ogg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      flac: "audio/flac",
    }[ext] ?? "application/octet-stream"
  );
}
