import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireOwner } from "@/lib/finance-auth";

/** Shared by the owner's finance routes (./route.ts, ./inbox/route.ts). */

const HEADERS = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

/** The finance database, but only for the owner: a valid Access token AND the owner's email. */
export async function ownerDb(request: Request): Promise<{ db: D1Database } | { denied: Response }> {
  const { env } = await getCloudflareContext({ async: true });
  // `next dev` has no Access in front of it; production builds never take this branch.
  if (process.env.NODE_ENV !== "development") {
    const owner = await requireOwner(request.headers, env);
    if (!owner.ok) return { denied: json({ error: "forbidden", reason: owner.reason }, 403) };
  }
  return { db: env.FINANCE_DB };
}

/** Writes must come from the finance page itself: the Access cookie is sent with any request to this origin. */
export function crossSite(request: Request): string | null {
  if (request.headers.get("x-finance-vault") !== "1") return "missing x-finance-vault header";
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "cross-site request";
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return "cross-origin request";
  return null;
}
