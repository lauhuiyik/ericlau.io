import { cookies } from "next/headers";

/**
 * The password gate in front of /tools/* (but not the /tools list itself).
 *
 * One shared password, TOOLS_PASSWORD, a Worker secret set with
 * `wrangler secret put TOOLS_PASSWORD`. Logging in at /tools/login sets an
 * HttpOnly cookie holding an expiry and an HMAC of it keyed by the password:
 * the password itself is never stored in the cookie, nothing is kept
 * server-side, and changing the password signs everyone out.
 *
 * Fails closed: with no TOOLS_PASSWORD set, nobody gets in.
 *
 * Each tool's page and API must call hasToolsSession() / openForTools()
 * themselves — there is no middleware doing it for them.
 */

export const TOOLS_COOKIE = "tools_session";
export const SESSION_DAYS = 30;
/** Wrong passwords allowed per IP before a lockout, and the lockout window. */
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hmacKey = (secret: string) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

// The scope keeps a session for one gate (the tools, or one private page) from opening another.
const sessionMessage = (exp: number, scope: string) => enc.encode(`${scope}-session:v1:${exp}`);

/** Cookie value for a fresh session: "<expiry unix seconds>.<HMAC>". */
export async function signSession(
  password: string,
  now = Date.now(),
  scope = "tools",
): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const exp = Math.floor(now / 1000) + maxAge;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(password), sessionMessage(exp, scope));
  return { value: `${exp}.${b64url(sig)}`, maxAge };
}

export async function verifySession(
  value: string | undefined,
  password: string | undefined,
  now = Date.now(),
  scope = "tools",
) {
  if (!value || !password) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{20,100})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < now) return false;
  try {
    // subtle.verify compares in constant time.
    return await crypto.subtle.verify("HMAC", await hmacKey(password), fromB64url(m[2]), sessionMessage(exp, scope));
  } catch {
    return false;
  }
}

/** Constant-time password check: an HMAC made with the guess must verify under the real password. */
export async function passwordMatches(guess: string, password: string | undefined): Promise<boolean> {
  if (!password || !guess) return false;
  const msg = enc.encode("tools-password-check");
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(guess), msg);
  return crypto.subtle.verify("HMAC", await hmacKey(password), sig, msg);
}

/** For pages: is this visitor logged in to the tools? */
export async function hasToolsSession(env: { TOOLS_PASSWORD?: string }): Promise<boolean> {
  const value = (await cookies()).get(TOOLS_COOKIE)?.value;
  return verifySession(value, env.TOOLS_PASSWORD);
}

/** Only ever send people back to a tools page after logging in (no open redirects). */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/tools(\/[A-Za-z0-9/_-]*)?$/.test(next) ? next : "/tools";
}

// ---- brute-force throttle (D1 table tools_login_failures) ----

/** Minutes until this IP may try again, or 0 if it's not locked out. */
export async function lockedOutFor(db: D1Database, ip: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare("SELECT fails, window_start FROM tools_login_failures WHERE ip = ?")
    .bind(ip)
    .first<{ fails: number; window_start: number }>();
  if (!row || now - row.window_start > FAIL_WINDOW_MS || row.fails < MAX_FAILS) return 0;
  return Math.ceil((row.window_start + FAIL_WINDOW_MS - now) / 60000);
}

export async function recordFailure(db: D1Database, ip: string, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO tools_login_failures (ip, fails, window_start) VALUES (?, 1, ?)
       ON CONFLICT (ip) DO UPDATE SET
         fails = CASE WHEN ? - window_start > ? THEN 1 ELSE fails + 1 END,
         window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END`,
    )
    .bind(ip, now, now, FAIL_WINDOW_MS, now, FAIL_WINDOW_MS, now)
    .run();
  // Keep the table tiny.
  await db.prepare("DELETE FROM tools_login_failures WHERE window_start < ?").bind(now - FAIL_WINDOW_MS).run();
}

export async function clearFailures(db: D1Database, ip: string) {
  await db.prepare("DELETE FROM tools_login_failures WHERE ip = ?").bind(ip).run();
}
