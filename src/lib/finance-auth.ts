import { type AccessResult, checkAccess } from "@/lib/cf-access";

/**
 * Who may open /experiments/finance and its vault: a request carrying a valid
 * Cloudflare Access token (src/lib/cf-access.ts) whose email is on
 * FINANCE_ALLOWED_EMAILS, a comma-separated Worker secret (kept out of the
 * public repo; set with `wrangler secret put FINANCE_ALLOWED_EMAILS`).
 *
 * The Access application is shared with /experiments/homeenergy, so a valid
 * token only proves someone got through that application's policy. The email
 * check limits finance to its owner even if that policy is later widened.
 * Fails closed: no secret, no email claim, or a different email all deny.
 */
export type OwnerEnv = { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; FINANCE_ALLOWED_EMAILS?: string };

export async function requireOwner(headers: Headers, env: OwnerEnv): Promise<AccessResult> {
  const gate = await checkAccess(headers, env);
  if (!gate.ok) return gate;
  const allowed = (env.FINANCE_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return { ok: false, reason: "no owner configured (FINANCE_ALLOWED_EMAILS)" };
  const email = typeof gate.email === "string" ? gate.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, reason: "the Access login didn't include an email" };
  if (!allowed.includes(email)) return { ok: false, reason: `signed in as ${gate.email}, which isn't this page's owner` };
  return gate;
}
