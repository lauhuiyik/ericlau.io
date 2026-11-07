import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasPageSession } from "@/lib/private-pages";

/**
 * /experiments/japan27 — Japan Dec 2026 trip page, password-gated.
 *
 * Unlike /experiments/japan2026 (static files in public/, so in this public
 * repo), this trip's files live only in the private R2 bucket
 * (ericlau-private, under japan27/) and in the private repo
 * lauhuiyik/japan2026-private (branch japan27). This route serves them
 * only to a browser holding the page's session cookie, which /gate/japan27
 * sets after the JAPAN27_PASSWORD secret (see src/lib/private-pages.ts).
 * Fails closed: with the secret unset, nobody gets in.
 *
 * Update the page: re-upload to R2, no site deploy needed, e.g.
 *   npx wrangler r2 object put ericlau-private/japan27/data.js --file data.js --remote
 */
export const dynamic = "force-dynamic";

const PREFIX = "japan27/";

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

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { env } = await getCloudflareContext({ async: true });
  const parts = (await params).path ?? [];
  if (!(await hasPageSession("japan27", env))) {
    // The page itself goes to the login; its files just refuse.
    const isPage = parts.length === 0 || (parts.length === 1 && parts[0] === "index.html");
    if (isPage) redirect("/gate/japan27");
    return new Response("Locked.", {
      status: 403,
      headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

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
