#!/usr/bin/env python3
"""Home-PC agent for ericlau.io/experiments/downloader.

Runs in the background on the owner's Windows PC (installed by install.ps1),
polls the site for queued links, downloads them with yt-dlp + ffmpeg on the
home connection, and uploads the results back to the site (R2), where the
gated page hands them out for 24 hours. A copy is also kept on the PC.

Only outbound HTTPS: the PC needs no open ports or tunnel. It authenticates
to /api/dl-agent/* with the connection key created on the gated page.

Standard library only, so it runs on Python's embeddable package. The yt-dlp
arguments, Instagram error handling and MP4 conversion mirror the desktop app
(youtube_downloader.py in the "Youtube Downloader" folder).

    pythonw dl_agent.py            run (what the scheduled task does)
    python  dl_agent.py --check    verify tools + connection key, then exit
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from logging.handlers import RotatingFileHandler
from pathlib import Path

VERSION = "1.0.0"
APP_DIR = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"
# CREATE_NO_WINDOW: no console window flashing up for each yt-dlp/ffmpeg run under pythonw
# (whose children also get stdin=DEVNULL: pythonw has no console handles to inherit).
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0
LOCK_PORT = 47391  # single-instance guard (bound on 127.0.0.1 only)

DEFAULTS = {
    "server": "https://ericlau.io",
    "key": "",
    "concurrency": 2,
    "save_dir": str(Path.home() / "Downloads" / "Web Downloads"),
    "keep_local_copy": True,
    "auto_update": True,
}

log = logging.getLogger("dl_agent")


class Cancelled(Exception):
    pass


class Failed(Exception):
    pass


# ── setup ──────────────────────────────────────────────────────────────────

def load_config(path: Path) -> dict:
    cfg = dict(DEFAULTS)
    if path.exists():
        cfg.update(json.loads(path.read_text("utf-8-sig")))
    cfg["server"] = str(cfg["server"]).rstrip("/")
    return cfg


def setup_logging(console: bool) -> None:
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = RotatingFileHandler(APP_DIR / "agent.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    if console and sys.stderr:
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        log.addHandler(sh)


def find_bin(name: str) -> str | None:
    exe = name + (".exe" if IS_WINDOWS else "")
    local = APP_DIR / "bin" / exe
    if local.exists():
        return str(local)
    for d in ("/opt/homebrew/bin", "/usr/local/bin"):  # for running the agent on a Mac
        p = Path(d) / exe
        if p.exists():
            return str(p)
    return shutil.which(name)


YT_DLP = find_bin("yt-dlp")
FFMPEG = find_bin("ffmpeg")
FFPROBE = find_bin("ffprobe")
DENO = find_bin("deno")  # yt-dlp needs a JS runtime for YouTube


def run_quiet(args: list[str], timeout: float = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
    )


def ytdlp_version() -> str:
    try:
        return run_quiet([YT_DLP, "--version"], timeout=60).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def kill_tree(proc: subprocess.Popen | None) -> None:
    """Stop yt-dlp and the ffmpeg it spawned."""
    if not proc or proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            run_quiet(["taskkill", "/T", "/F", "/PID", str(proc.pid)], timeout=30)
        else:
            proc.terminate()
    except Exception:  # noqa: BLE001
        pass


def keep_awake(on: bool) -> None:
    """Stop Windows from sleeping mid-download (released when idle)."""
    if not IS_WINDOWS:
        return
    try:
        import ctypes
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001
        ctypes.windll.kernel32.SetThreadExecutionState(
            ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if on else 0)
        )
    except Exception:  # noqa: BLE001
        pass


# ── site API ───────────────────────────────────────────────────────────────

class Api:
    def __init__(self, server: str, key: str) -> None:
        self.server = server
        self.key = key

    def call(self, method: str, path: str, body: object = None, raw: bytes | None = None,
             timeout: float = 30) -> tuple[int, dict]:
        """Returns (status, json). Raises on network errors (no HTTP response)."""
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.server + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("User-Agent", f"EricLauDownloaderAgent/{VERSION}")
        if raw is not None:
            req.add_header("Content-Type", "application/octet-stream")
        elif body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"{}")
            except Exception:  # noqa: BLE001
                payload = {}
            return e.code, payload


# ── one job ────────────────────────────────────────────────────────────────

def is_soundcloud(url: str) -> bool:
    u = url.lower()
    return "soundcloud.com" in u or "snd.sc" in u


def is_instagram(url: str) -> bool:
    u = url.lower()
    return "instagram.com" in u or "instagr.am" in u


class JobRunner(threading.Thread):
    def __init__(self, agent: "Agent", job: dict) -> None:
        super().__init__(daemon=True, name=f"job-{job['id']}")
        self.agent = agent
        self.id: str = job["id"]
        self.url: str = job["url"]
        self.mode: str = job["mode"]
        self.cookies: str = job.get("cookiesBrowser") or ""
        self.cancelled = threading.Event()
        self.proc: subprocess.Popen | None = None
        self.errors: list[str] = []
        self.title = ""
        self._last_report = 0.0

    # -- reporting --
    def cancel(self) -> None:
        self.cancelled.set()
        kill_tree(self.proc)

    def report(self, force: bool = False, **fields) -> None:
        now = time.monotonic()
        if not force and now - self._last_report < 1.5:
            return
        self._last_report = now
        if self.title:
            fields.setdefault("title", self.title)
        try:
            status, resp = self.agent.api.call("POST", f"/api/dl-agent/jobs/{self.id}", fields)
            if status == 404 or resp.get("cancel"):
                self.cancel()
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] progress report failed: %s", self.id, exc)

    def check_cancel(self) -> None:
        if self.cancelled.is_set():
            raise Cancelled()

    # -- main --
    def run(self) -> None:
        work = APP_DIR / "work" / self.id
        try:
            work.mkdir(parents=True, exist_ok=True)
            log.info("[%s] %s %s", self.id, self.mode, self.url)
            self.report(force=True, status="downloading", progress=0, message="")
            rc = self.download(work)
            self.check_cancel()
            files, note = self.collect(work, rc)
            if self.mode == "video" and is_instagram(self.url):
                files = [self.ensure_mp4(f) for f in files]
            self.upload(files)
            if self.agent.cfg.get("keep_local_copy"):
                self.save_local(files)
            self.report(force=True, status="done", progress=100, message=note)
            log.info("[%s] done: %s", self.id, ", ".join(f.name for f in files))
        except Cancelled:
            log.info("[%s] cancelled", self.id)
            self.report(force=True, status="cancelled", message="")
        except Failed as exc:
            log.info("[%s] failed: %s", self.id, exc)
            self.report(force=True, status="failed", message=str(exc))
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] crashed", self.id)
            self.report(force=True, status="failed", message=f"Agent error: {exc}")
        finally:
            shutil.rmtree(work, ignore_errors=True)
            self.agent.job_finished(self.id)

    # -- download --
    def build_args(self, work: Path) -> list[str]:
        args = [
            YT_DLP,
            "--newline",
            "--no-playlist",
            "--no-mtime",
            # Cap the title, not the path: --trim-filenames counts the whole path
            # and would cut into the work folder's name.
            "-o", str(work / "%(title).100B [%(id)s].%(ext)s"),
        ]
        if FFMPEG:
            args += ["--ffmpeg-location", FFMPEG]
        if DENO and IS_WINDOWS:
            args += ["--js-runtimes", f"deno:{DENO}"]
        if is_instagram(self.url):
            if self.cookies:
                args += ["--cookies-from-browser", self.cookies]
            # Carousels arrive as a playlist: keep going past photo slides
            # ("No video formats found") so the videos still download.
            args += ["--ignore-errors"]

        if self.mode == "mp3":
            return args + [
                "-f", "bestaudio/best", "-x",
                "--audio-format", "mp3", "--audio-quality", "0",
                "--embed-thumbnail", "--add-metadata",
                self.url,
            ]
        if is_soundcloud(self.url):
            # Audio-only source: best audio as-is, no MP4 mux.
            return args + ["-f", "bestaudio/best", "--embed-thumbnail", "--add-metadata", self.url]
        # Prefer H.264 + AAC so the file is a real MP4 that plays anywhere; fall
        # back to best-of-anything (MKV) rather than forcing other codecs into MP4.
        return args + [
            "-f",
            "bv*[ext=mp4][vcodec~='^(avc1|h264)']+ba[ext=m4a]"
            "/b[ext=mp4][vcodec~='^(avc1|h264)']"
            "/bv*+ba/b",
            "--merge-output-format", "mp4/mkv",
            "--embed-metadata",
            "--embed-subs", "--sub-langs", "en.*",
            self.url,
        ]

    def download(self, work: Path) -> int:
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        self.proc = subprocess.Popen(
            self.build_args(work),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env=env, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
        )
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            if line:
                self.parse_line(line)
            if self.cancelled.is_set():
                kill_tree(self.proc)
        return self.proc.wait()

    def parse_line(self, line: str) -> None:
        if line.startswith("ERROR:"):
            self.errors.append(line)
            log.info("[%s] %s", self.id, line)
            return
        if "Destination:" in line and not self.title:
            # "Title [id].mp4", "Title [id].f137.mp4", "Title [id].en.vtt" → "Title"
            name = Path(line.split("Destination:", 1)[1].strip().strip('"')).name
            self.title = re.sub(r"\s*\[[^\[\]]*\][^\[\]]*$", "", name)
        if line.startswith("[download]") and "%" in line:
            for tok in line.split():
                if tok.endswith("%"):
                    try:
                        self.report(status="downloading", progress=float(tok.rstrip("%")))
                    except ValueError:
                        pass
                    return
        if line.startswith(("[ExtractAudio]", "[Merger]")):
            self.report(force=True, status="converting", message="")

    def collect(self, work: Path, rc: int) -> tuple[list[Path], str]:
        """Finished files in the work folder, or Failed with a useful reason.

        Final files end in "[id].ext"; anything else (".f137.mp4" halves of a
        merge, ".part", subtitles, thumbnails) is an intermediate.
        """
        files = sorted(
            p for p in work.iterdir()
            if p.is_file() and p.stem.endswith("]") and p.suffix not in (".part", ".ytdl", ".temp")
            and p.stat().st_size > 0
        )
        if rc == 0:
            if not files:
                raise Failed("yt-dlp finished but produced no file")
            return files, ""

        errs = [e.lower() for e in self.errors]
        photo = [e for e in errs if "no video formats found" in e]
        if is_instagram(self.url) and errs and len(photo) == len(errs):
            if files:
                return files, f"Skipped {len(photo)} photo slide(s)"
            raise Failed("No video in this post")
        if files and is_instagram(self.url):
            # Some carousel items failed for another reason; keep what we got.
            return files, f"Some items failed: {self.short_error()}"
        raise Failed(self.explain(rc))

    def short_error(self) -> str:
        if not self.errors:
            return ""
        return re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?", "", self.errors[-1])[:300]

    def explain(self, rc: int) -> str:
        errs = " ".join(self.errors).lower()
        browser = self.cookies.capitalize() if self.cookies else ""
        if self.cookies in ("chrome", "edge", "brave") and (
            "could not copy" in errs or "permission denied" in errs or "being used by another process" in errs
        ):
            return f"Couldn't read {browser}'s cookies while it's open. Close {browser} and retry, or use Firefox."
        if self.cookies and ("decrypt" in errs or "app-bound" in errs or "app bound" in errs):
            return f"{browser} encrypts its cookies on Windows so yt-dlp can't read them. Use Firefox for Instagram login."
        if self.cookies and "cookies database" in errs:
            return f"Couldn't find {browser}'s cookies on the PC. Is it installed and signed into Instagram?"
        if "sign in to confirm" in errs or "not a bot" in errs:
            return "YouTube asked for a bot check. Try again later."
        if is_instagram(self.url) and ("login" in errs or "cookies" in errs or "rate-limit" in errs):
            if self.cookies:
                return f"Instagram still refused with {browser}'s login. Make sure you're signed into instagram.com in {browser} on the PC."
            return 'Instagram wants a login for this link. Pick a browser under "Instagram login" and retry.'
        return self.short_error() or f"yt-dlp failed (exit {rc})"

    # -- Instagram → MP4 (same rules as the desktop app) --
    def ensure_mp4(self, src: Path) -> Path:
        vcodec, acodec = probe_codecs(src)
        if vcodec is None:
            return src
        if src.suffix.lower() == ".mp4" and vcodec == "h264" and acodec in ("aac", ""):
            return src
        v_args = ["-c:v", "copy"] if vcodec == "h264" else [
            "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"]
        a_args = ["-c:a", "copy"] if acodec in ("aac", "") else ["-c:a", "aac", "-b:a", "192k"]
        dst = src.with_suffix(".mp4")
        tmp = src.with_name(src.stem + ".converting.mp4")
        self.report(force=True, status="converting", message="Converting to MP4")
        self.proc = subprocess.Popen(
            [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
             "-map", "0:v:0", "-map", "0:a:0?", *v_args, *a_args,
             "-movflags", "+faststart", str(tmp)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
        )
        out, _ = self.proc.communicate()
        if self.cancelled.is_set() or self.proc.returncode != 0:
            tmp.unlink(missing_ok=True)
            self.check_cancel()
            raise Failed(f"MP4 conversion failed: {out.decode('utf-8', 'replace').strip()[:200]}")
        tmp.replace(dst)
        if src != dst:
            src.unlink(missing_ok=True)
        return dst

    # -- upload --
    def upload(self, files: list[Path]) -> None:
        total = sum(f.stat().st_size for f in files) or 1
        done = 0
        self.report(force=True, status="uploading", progress=0, message="")
        for f in files:
            size = f.stat().st_size
            status, r = self.agent.api.call(
                "POST", f"/api/dl-agent/jobs/{self.id}/files", {"name": f.name, "size": size})
            if status == 404:
                raise Cancelled()
            if status != 200:
                raise Failed(f"Upload refused: {r.get('error', status)}")
            file_id, part_size = r["fileId"], int(r["partSize"])
            parts = []
            try:
                with open(f, "rb") as fh:
                    n = 1
                    while True:
                        chunk = fh.read(part_size)
                        if not chunk:
                            break
                        etag = self.upload_part(file_id, n, chunk)
                        parts.append({"partNumber": n, "etag": etag})
                        done += len(chunk)
                        self.report(status="uploading", progress=100 * done / total)
                        self.check_cancel()
                        if len(chunk) < part_size:
                            break
                        n += 1
                status, r = self.agent.api.call(
                    "POST", f"/api/dl-agent/files/{file_id}", {"parts": parts}, timeout=120)
                if status != 200:
                    raise Failed(f"Upload didn't complete: {r.get('error', status)}")
            except BaseException:
                try:
                    self.agent.api.call("DELETE", f"/api/dl-agent/files/{file_id}")
                except Exception:  # noqa: BLE001
                    pass
                raise

    def upload_part(self, file_id: str, n: int, chunk: bytes) -> str:
        last = ""
        for attempt in range(5):
            self.check_cancel()
            try:
                status, r = self.agent.api.call(
                    "PUT", f"/api/dl-agent/files/{file_id}?part={n}", raw=chunk, timeout=300)
                if status == 200:
                    return r["etag"]
                if status == 404:
                    raise Cancelled()
                last = f"HTTP {status} {r.get('error', '')}"
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                last = str(exc)
            time.sleep(2 ** attempt)
        raise Failed(f"Upload failed: {last}")

    def save_local(self, files: list[Path]) -> None:
        dest = Path(self.agent.cfg["save_dir"]).expanduser()
        try:
            dest.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copy2(f, dest / f.name)
        except Exception as exc:  # noqa: BLE001
            log.warning("[%s] couldn't keep a local copy: %s", self.id, exc)


def probe_codecs(path: Path) -> tuple[str | None, str]:
    """(video codec, audio codec); video None if there's no video stream, audio "" if no audio."""
    try:
        out = run_quiet([
            FFPROBE, "-v", "error",
            "-show_entries", "stream=codec_type,codec_name:stream_disposition=attached_pic",
            "-of", "json", str(path)], timeout=60)
        streams = json.loads(out.stdout or "{}").get("streams", [])
    except Exception:  # noqa: BLE001
        return None, ""
    video = next((s.get("codec_name") for s in streams
                  if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s.get("codec_name") for s in streams if s.get("codec_type") == "audio"), "")
    return video, audio or ""


# ── the loop ───────────────────────────────────────────────────────────────

class Agent:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self.api = Api(cfg["server"], cfg["key"])
        self.jobs: dict[str, JobRunner] = {}
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.yt_version = ytdlp_version()
        self.last_update = 0.0

    def job_finished(self, job_id: str) -> None:
        with self.lock:
            self.jobs.pop(job_id, None)
        self.wake.set()  # poll again now: there's a free slot

    def info(self) -> dict:
        return {
            "version": VERSION,
            "ytDlp": self.yt_version,
            "host": socket.gethostname(),
            "os": platform.platform(terse=True),
        }

    def maybe_update(self) -> None:
        """yt-dlp breaks whenever sites change, so self-update daily (only while idle)."""
        if not self.cfg.get("auto_update") or time.time() - self.last_update < 12 * 3600:
            return
        with self.lock:
            if self.jobs:
                return
        self.last_update = time.time()
        try:
            out = run_quiet([YT_DLP, "-U"], timeout=300)
            log.info("yt-dlp -U: %s", (out.stdout + out.stderr).strip().splitlines()[-1:])
            self.yt_version = ytdlp_version()
        except Exception as exc:  # noqa: BLE001
            log.warning("yt-dlp update failed: %s", exc)

    def run(self) -> None:
        log.info("agent %s starting; server %s; yt-dlp %s", VERSION, self.cfg["server"], self.yt_version)
        # Leftovers from a crash or reboot mid-job; the site fails those jobs on our first poll.
        shutil.rmtree(APP_DIR / "work", ignore_errors=True)
        backoff = 2.0
        while True:
            self.maybe_update()
            with self.lock:
                running = list(self.jobs)
            free = max(0, int(self.cfg.get("concurrency", 2)) - len(running))
            delay = 10.0
            try:
                status, resp = self.api.call("POST", "/api/dl-agent/poll", {
                    "running": running, "freeSlots": free, "info": self.info()})
                if status == 401:
                    log.error("connection key rejected: create a new one on the page and rerun the installer")
                    delay = 60
                elif status != 200:
                    raise RuntimeError(f"HTTP {status} {resp}")
                else:
                    backoff = 2.0
                    for job in resp.get("jobs", []):
                        runner = JobRunner(self, job)
                        with self.lock:
                            self.jobs[runner.id] = runner
                        runner.start()
                    for job_id in resp.get("cancel", []):
                        with self.lock:
                            r = self.jobs.get(job_id)
                        if r:
                            log.info("[%s] cancel requested", job_id)
                            r.cancel()
                    delay = max(1.0, float(resp.get("nextPollMs", 10000)) / 1000)
            except Exception as exc:  # noqa: BLE001
                log.warning("poll failed: %s (retrying in %.0fs)", exc, backoff)
                delay = backoff
                backoff = min(backoff * 2, 60)
            with self.lock:
                keep_awake(bool(self.jobs))
            self.wake.wait(delay)
            self.wake.clear()


def check(cfg: dict) -> int:
    """Used by the installer: are the tools there, and does the site accept the key?"""
    ok = True
    for name, path in (("yt-dlp", YT_DLP), ("ffmpeg", FFMPEG), ("ffprobe", FFPROBE), ("deno", DENO)):
        print(f"{name:8} {path or 'MISSING'}")
        ok &= bool(path)
    if YT_DLP:
        print(f"yt-dlp version {ytdlp_version() or '?'}")
    try:
        status, resp = Api(cfg["server"], cfg["key"]).call(
            "POST", "/api/dl-agent/poll", {"running": [], "freeSlots": 0, "info": {}})
        if status == 200:
            print(f"server   {cfg['server']}: connection key accepted")
        elif status == 401:
            print(f"server   {cfg['server']}: connection key REJECTED")
            ok = False
        else:
            print(f"server   {cfg['server']}: HTTP {status} {resp}")
            ok = False
    except Exception as exc:  # noqa: BLE001
        print(f"server   {cfg['server']}: unreachable ({exc})")
        ok = False
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=APP_DIR / "config.json")
    ap.add_argument("--check", action="store_true", help="verify setup and exit")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.check:
        return check(cfg)

    setup_logging(console=sys.stderr is not None and sys.stderr.isatty())
    if not cfg["key"]:
        log.error("no connection key in %s", args.config)
        return 1
    if not (YT_DLP and FFMPEG and FFPROBE):
        log.error("missing tools: yt-dlp=%s ffmpeg=%s ffprobe=%s", YT_DLP, FFMPEG, FFPROBE)
        return 1

    # One agent per PC: a second copy (e.g. task restarted while running) exits.
    lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))
    except OSError:
        log.info("another agent is already running; exiting")
        return 0

    Agent(cfg).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
