import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAccess } from "@/lib/cf-access";

/**
 * Japan Dec 2026 trip page, behind Cloudflare Access.
 *
 * Unlike /experiments/japan2026 (static files in public/, so in this public
 * repo), this trip's files live only in the private R2 bucket
 * (ericlau-private, under japan-dec2026/) and in the private repo
 * lauhuiyik/japan2026-private (branch japan-dec2026). This route serves them
 * only after:
 *   1. Cloudflare Access lets the request through. Its Access application
 *      must cover ericlau.io/experiments/japan-dec2026 (set in the dashboard).
 *   2. This route verifies the Access token itself (src/lib/cf-access.ts), so a
 *      dashboard slip that drops the path leaves the page locked, not public.
 * The token is checked against JAPAN_DEC2026_ACCESS_AUD if set (a separate
 * Access app), else the shared app's CF_ACCESS_AUD.
 *
 * Update the page: re-upload to R2, no site deploy needed, e.g.
 *   npx wrangler r2 object put ericlau-private/japan-dec2026/data.js --file data.js --remote
 */
export const dynamic = "force-dynamic";

const PREFIX = "japan-dec2026/";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { env } = await getCloudflareContext({ async: true });
  const gate = await checkAccess(request.headers, {
    CF_ACCESS_TEAM_DOMAIN: env.CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD: env.JAPAN_DEC2026_ACCESS_AUD || env.CF_ACCESS_AUD,
  });
  if (!gate.ok) {
    return new Response(`Locked: ${gate.reason}.`, {
      status: 403,
      headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const parts = (await params).path ?? [];
  // Only plain file names: no "..", no hidden files, nothing outside the prefix.
  if (parts.some((p) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) || p.includes(".."))) {
    return new Response("Not found", { status: 404, headers: HEADERS });
  }
  const key = PREFIX + (parts.length ? parts.join("/") : "index.html");
  const ext = key.split(".").pop()!.toLowerCase();
  const type = TYPES[ext];
  if (!type) return new Response("Not found", { status: 404, headers: HEADERS });

  const object = await env.PRIVATE_BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404, headers: HEADERS });

  return new Response(object.body, {
    headers: {
      ...HEADERS,
      "Content-Type": type,
      ...(ext === "html" ? { "X-Frame-Options": "DENY" } : {}),
    },
  });
}
