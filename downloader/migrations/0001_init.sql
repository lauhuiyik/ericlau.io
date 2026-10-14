-- /tools/downloader (D1 database ericlau-downloader).
-- The web page queues jobs here; the home-PC agent (downloader/agent/) claims
-- them, runs yt-dlp + ffmpeg, and uploads the results to R2 (DL_BUCKET).
-- Times are unix milliseconds.

CREATE TABLE dl_jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('video', 'mp3')),
  cookies_browser TEXT NOT NULL DEFAULT '',
  -- queued → starting → downloading → converting → uploading → done
  -- (or failed / cancelled from any of them)
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX dl_jobs_status ON dl_jobs (status, created_at);

-- One row per output file (a carousel post produces several). The object
-- lives in R2 under r2_key; upload_id is set while the multipart upload is open.
CREATE TABLE dl_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  upload_id TEXT,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX dl_files_job ON dl_files (job_id);
CREATE INDEX dl_files_created ON dl_files (created_at);

-- Home PCs allowed to claim jobs. Only a SHA-256 of each connection key is
-- stored; the key itself is shown once, on the gated page, when it's created.
CREATE TABLE dl_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  info TEXT NOT NULL DEFAULT '{}'
);

-- Small key/value state: when the page was last open (agents poll faster
-- while it is) and when expired files were last swept.
CREATE TABLE dl_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
