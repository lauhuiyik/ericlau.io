#!/usr/bin/env python3
"""Builds public/experiments/downloader/EricLauDownloader-Setup.zip from this folder.

Run after changing anything in downloader/agent/, and commit the zip (the
downloader page links to it; it sits behind the same Access path):

    python3 downloader/agent/build_zip.py

Windows scripts get CRLF line endings and must be ASCII (PowerShell 5.1 reads
BOM-less scripts as ANSI). Timestamps are fixed so an unchanged agent gives a
byte-identical zip.
"""

import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "public" / "experiments" / "downloader" / "EricLauDownloader-Setup.zip"
FILES = ["Install.cmd", "Uninstall.cmd", "install.ps1", "uninstall.ps1", "dl_agent.py", "README.txt"]
CRLF = {".cmd", ".ps1", ".txt"}
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in FILES:
            src = HERE / name
            data = src.read_bytes()
            if src.suffix in CRLF:
                try:
                    data.decode("ascii")
                except UnicodeDecodeError as exc:
                    print(f"{name} must be ASCII-only: {exc}", file=sys.stderr)
                    return 1
                data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            info = zipfile.ZipInfo(f"EricLauDownloader-Setup/{name}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
