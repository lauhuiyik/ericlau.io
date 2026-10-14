EricLau Downloader - home PC agent
===================================

This lets ericlau.io/experiments/downloader use this PC to download
YouTube, SoundCloud and Instagram links. The site queues links, this PC
downloads them on your home connection, and the finished files show up on
the page (kept for 24 hours). A copy also goes to Downloads\Web Downloads.

Install
  1. On the downloader page, open "PC setup" and click "Create key".
  2. Extract this zip (right-click > Extract All).
  3. Double-click Install.cmd and paste the key when asked.
     If Windows SmartScreen warns you, click "More info" > "Run anyway".

It installs just for your Windows user (no admin rights), into
%LOCALAPPDATA%\EricLauDownloader, and starts automatically when you log in.
It only makes outbound HTTPS connections; no ports are opened.

Upgrade: run Install.cmd from a newer zip. It keeps your key.
Uninstall: double-click Uninstall.cmd, then "Disconnect" the PC on the page.
Log file: %LOCALAPPDATA%\EricLauDownloader\agent.log

Instagram login: pick a browser on the downloader page. On Windows,
Firefox works best: Chrome and Edge lock and encrypt their cookies.
