"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

type JobFile = { id: string; name: string; size: number; expiresAt: number };
type Job = {
  id: string;
  url: string;
  mode: "video" | "mp3";
  cookiesBrowser: string;
  status: "queued" | "starting" | "downloading" | "converting" | "uploading" | "done" | "failed" | "cancelled";
  progress: number;
  message: string;
  title: string;
  cancelRequested: boolean;
  createdAt: number;
  finishedAt: number | null;
  files: JobFile[];
};
type Agent = {
  id: string;
  name: string;
  createdAt: number;
  lastSeen: number | null;
  online: boolean;
  info: { version?: string; ytDlp?: string; host?: string; os?: string };
};
type State = { now: number; jobs: Job[]; agents: Agent[] };

const API = "/experiments/downloader/api";
const INSTALLER = "/experiments/downloader/EricLauDownloader-Setup.zip";
const ACTIVE = new Set(["queued", "starting", "downloading", "converting", "uploading"]);
const COOKIE_OPTIONS = [
  { value: "", label: "None (public posts only)" },
  { value: "firefox", label: "Firefox (works best on Windows)" },
  { value: "chrome", label: "Chrome" },
  { value: "edge", label: "Edge" },
  { value: "brave", label: "Brave" },
];

async function send(path: string, init: { method: string; body?: unknown }) {
  const r = await fetch(`${API}${path}`, {
    method: init.method,
    headers: { "content-type": "application/json", "x-downloader": "1" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(data.error ?? data.reason ?? `HTTP ${r.status}`));
  return data;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function statusText(j: Job) {
  if (j.cancelRequested && ACTIVE.has(j.status)) return "Cancelling…";
  switch (j.status) {
    case "queued":
      return "Queued";
    case "starting":
      return "Starting…";
    case "downloading":
      return `Downloading ${j.progress.toFixed(0)}%`;
    case "converting":
      return "Converting…";
    case "uploading":
      return `Sending to site ${j.progress.toFixed(0)}%`;
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

const btn = "rounded border border-rule px-3 py-1 text-sm hover:border-muted disabled:opacity-50";
const label = "font-mono text-[10px] uppercase tracking-[0.22em] text-muted";

export function DownloaderApp() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [links, setLinks] = useState("");
  const [mode, setMode] = useState<"video" | "mp3">("video");
  const [cookies, setCookies] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [pcName, setPcName] = useState("Home PC");
  const [copied, setCopied] = useState(false);
  const stateRef = useRef<State | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API}/jobs`, { cache: "no-store" });
      const data = (await r.json()) as State & { error?: string; reason?: string };
      if (!r.ok) throw new Error(data.reason ?? data.error ?? `HTTP ${r.status}`);
      stateRef.current = data;
      setState(data);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Poll fast while anything is moving (or a new PC is about to connect), slowly otherwise.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (!document.hidden) await refresh();
      if (stopped) return;
      const s = stateRef.current;
      const busyNow = !!s?.jobs.some((j) => ACTIVE.has(j.status)) || (newKey !== null && !s?.agents.some((a) => a.online));
      timer = setTimeout(tick, busyNow ? 2000 : 8000);
    };
    tick();
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, newKey]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const urls = links
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    if (urls.length === 0) {
      setFormError("Paste at least one http(s) link.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await send("/jobs", { method: "POST", body: { urls, mode, cookiesBrowser: cookies } });
      setLinks("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function onLinksChange(v: string) {
    setLinks(v);
    // SoundCloud is audio-only: nudge to MP3, like the desktop app does.
    if (mode === "video" && /soundcloud\.com|snd\.sc/i.test(v) && !/youtu|instagram/i.test(v)) setMode("mp3");
  }

  async function createKey() {
    try {
      const r = await send("/agents", { method: "POST", body: { name: pcName } });
      setNewKey(String(r.key));
      setCopied(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    refresh();
  }

  const jobs = state?.jobs ?? [];
  const agents = state?.agents ?? [];
  const online = agents.filter((a) => a.online);
  // Server time from the last poll (everything below only renders once that's loaded).
  const now = state?.now ?? 0;
  const hasFinished = jobs.some((j) => !ACTIVE.has(j.status));
  const queuedCount = jobs.filter((j) => j.status === "queued").length;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/experiments"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Experiments
        </Link>
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">Downloader</div>
      </header>

      <section className="px-6 sm:px-12 pt-12 sm:pt-16 pb-10 max-w-3xl">
        <div className={`${label} mb-6`}>Private tool</div>
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-[-0.03em] leading-[0.9]">Downloader</h1>
        <p className="mt-6 max-w-xl text-muted leading-relaxed">
          YouTube, SoundCloud and Instagram. The home PC does the downloading and hands the files back here. Files are
          kept for 24 hours.
        </p>
        <div className="mt-6 flex items-center gap-2 text-sm">
          {state === null ? (
            <span className="text-muted">{loadError ? `Couldn't load: ${loadError}` : "Loading…"}</span>
          ) : online.length > 0 ? (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span>
                {online.map((a) => a.name).join(", ")} online
                {online[0].info.ytDlp ? <span className="text-muted"> · yt-dlp {online[0].info.ytDlp}</span> : null}
              </span>
            </>
          ) : agents.length > 0 ? (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              <span>
                PC offline
                {agents[0].lastSeen ? (
                  <span className="text-muted"> · last seen {fmtAgo(now - agents[0].lastSeen)}</span>
                ) : null}
                <span className="text-muted"> · links wait in the queue until it&apos;s back</span>
              </span>
            </>
          ) : (
            <>
              <span className="inline-block h-2 w-2 rounded-full bg-muted" />
              <span className="text-muted">No PC connected yet. Set one up below.</span>
            </>
          )}
        </div>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-10 max-w-3xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className={label} htmlFor="links">
            Links
          </label>
          <textarea
            id="links"
            value={links}
            onChange={(e) => onLinksChange(e.target.value)}
            rows={3}
            placeholder="Paste one or more links (one per line)"
            className="rounded border border-rule bg-background px-3 py-2 font-mono text-sm placeholder:text-muted focus:outline-none focus:border-muted"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded border border-rule text-sm" role="radiogroup" aria-label="Mode">
              {(
                [
                  ["video", "Video (MP4)"],
                  ["mp3", "Audio (MP3)"],
                ] as const
              ).map(([v, text]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={mode === v}
                  onClick={() => setMode(v)}
                  className={`px-3 py-2 ${mode === v ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
                >
                  {text}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              Instagram login
              <select
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                className="rounded border border-rule bg-background px-2 py-2 text-foreground"
              >
                {COOKIE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded border border-foreground bg-foreground px-4 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add to queue"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Instagram login uses a browser on the PC where you&apos;re signed into Instagram. It&apos;s needed for
            private posts, stories, and &ldquo;login required&rdquo; errors.
          </p>
          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
        </form>
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-10 max-w-3xl">
        <div className="flex items-center justify-between">
          <div className={label}>
            Queue{queuedCount > 0 && online.length === 0 ? ` · ${queuedCount} waiting for the PC` : ""}
          </div>
          {hasFinished ? (
            <button
              className={`${btn} text-muted`}
              onClick={() => act(() => send("/clear", { method: "POST" }))}
            >
              Clear finished
            </button>
          ) : null}
        </div>
        {jobs.length === 0 ? (
          <p className="mt-6 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-rule">
            {jobs.map((j) => (
              <JobItem key={j.id} job={j} now={now} act={act} />
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-rule px-6 sm:px-12 py-10 max-w-3xl">
        <details open={agents.length === 0}>
          <summary className={`${label} cursor-pointer select-none`}>PC setup</summary>
          <ol className="mt-6 flex flex-col gap-6 text-sm">
            <li>
              <div className="font-medium">1. Download the installer on your Windows PC</div>
              <p className="mt-1 text-muted">
                Windows 10 or 11. It sets up yt-dlp, ffmpeg and a small background program, with no admin rights
                needed.
              </p>
              <a href={INSTALLER} className={`${btn} mt-3 inline-block`}>
                Download EricLauDownloader-Setup.zip
              </a>
            </li>
            <li>
              <div className="font-medium">2. Create a connection key</div>
              <p className="mt-1 text-muted">It&apos;s shown once. Paste it into the installer when it asks.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={pcName}
                  onChange={(e) => setPcName(e.target.value)}
                  aria-label="PC name"
                  className="w-40 rounded border border-rule bg-background px-3 py-1 text-sm"
                />
                <button className={btn} onClick={createKey}>
                  Create key
                </button>
              </div>
              {newKey ? (
                <div className="mt-3 flex flex-col gap-2">
                  <code className="break-all rounded border border-rule px-3 py-2 font-mono text-xs">{newKey}</code>
                  <div className="flex items-center gap-2">
                    <button
                      className={btn}
                      onClick={async () => {
                        await navigator.clipboard.writeText(newKey);
                        setCopied(true);
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button className={`${btn} text-muted`} onClick={() => setNewKey(null)}>
                      Hide
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
            <li>
              <div className="font-medium">3. On the PC</div>
              <p className="mt-1 text-muted">
                Extract the zip (right-click → Extract All), double-click <code>Install.cmd</code> and paste the key.
                If Windows warns about an unrecognised app, click More info → Run anyway. The PC shows up above as
                online within a few seconds.
              </p>
            </li>
          </ol>
          {agents.length > 0 ? (
            <div className="mt-8">
              <div className={label}>Connected PCs</div>
              <ul className="mt-3 flex flex-col divide-y divide-rule text-sm">
                {agents.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <span className={a.online ? "" : "text-muted"}>
                        {a.name} · {a.online ? "online" : a.lastSeen ? `last seen ${fmtAgo(now - a.lastSeen)}` : "never connected"}
                      </span>
                      {a.info.host ? (
                        <div className="text-xs text-muted">
                          {a.info.host}
                          {a.info.version ? ` · agent ${a.info.version}` : ""}
                          {a.info.ytDlp ? ` · yt-dlp ${a.info.ytDlp}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className={`${btn} text-muted`}
                      onClick={() =>
                        confirm(`Disconnect ${a.name}? Its key stops working; you'd need a new one to reconnect.`) &&
                        act(() => send(`/agents?id=${encodeURIComponent(a.id)}`, { method: "DELETE" }))
                      }
                    >
                      Disconnect
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      </section>
    </div>
  );
}

function JobItem({ job: j, now, act }: { job: Job; now: number; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const active = ACTIVE.has(j.status);
  const showBar = j.status === "downloading" || j.status === "uploading";
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-foreground/90" title={j.url}>
            {j.title || j.url}
          </div>
          <div className="mt-1 text-xs text-muted">
            <span className="font-mono uppercase tracking-[0.12em]">{j.mode === "mp3" ? "MP3" : "Video"}</span>
            {" · "}
            <span className={j.status === "failed" ? "text-red-400" : j.status === "done" ? "text-emerald-400" : ""}>
              {statusText(j)}
            </span>
            {j.message && !(j.cancelRequested && active) ? ` · ${j.message}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <button className={`${btn} text-muted`} onClick={() => act(() => send(`/jobs/${j.id}`, { method: "POST", body: { action: "cancel" } }))}>
              Cancel
            </button>
          ) : null}
          {j.status === "failed" || j.status === "cancelled" ? (
            <button className={btn} onClick={() => act(() => send(`/jobs/${j.id}`, { method: "POST", body: { action: "retry" } }))}>
              Retry
            </button>
          ) : null}
          {!active ? (
            <button className={`${btn} text-muted`} onClick={() => act(() => send(`/jobs/${j.id}`, { method: "DELETE" }))}>
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {showBar ? (
        <div className="mt-3 h-1 w-full overflow-hidden rounded bg-rule">
          <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${Math.max(2, j.progress)}%` }} />
        </div>
      ) : null}
      {j.files.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {j.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 text-sm">
              <a href={`${API}/files/${f.id}`} className={`${btn} border-foreground`} download>
                Download
              </a>
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="text-xs text-muted">
                {fmtSize(f.size)} · expires in {Math.max(0, Math.round((f.expiresAt - now) / 3600000))} h
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
