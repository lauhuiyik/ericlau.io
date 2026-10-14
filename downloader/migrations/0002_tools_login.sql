-- Failed /tools/login attempts per IP, so the password can't be guessed at
-- speed (src/lib/tools-auth.ts). Lives here because this is the tools'
-- only database. Times are unix milliseconds.

CREATE TABLE tools_login_failures (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
