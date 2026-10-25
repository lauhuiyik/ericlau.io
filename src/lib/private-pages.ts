import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { signSession, verifySession } from "@/lib/tools-auth";

/**
 * Password-gated HTML pages.
 *
 * This repo is public and files in public/ are served before any code runs,
 * so a private page's HTML lives in the R2 bucket ericlau-private (no public
 * domain) and only a route handler that has checked the password reads it.
 *
 * To add one:
 *   1. npx wrangler r2 object put ericlau-private/<slug>/index.html --file <file> --remote
 *   2. npx wrangler secret put <SECRET>
 *   3. Add an entry below, and a route.ts at its path calling servePrivatePage("<slug>").
 * Re-upload with step 1 to update the page; nothing is cached.
 *
 * Each page has its own password (a Worker secret) and its own session
 * cookie, signed the same way as the tools gate (src/lib/tools-auth.ts).
 * Login is at /gate/<slug>. Fails closed: with the secret unset, nobody gets in.
 */

export type PrivatePage = {
  /** Where the page is served (it needs a route.ts there). */
  path: string;
  title: string;
  /** Object key in ericlau-private. */
  object: string;
  /** Name of the Worker secret holding this page's password. */
  secret: "LAU_FAMILY_PASSWORD";
};

export const PRIVATE_PAGES: Record<string, PrivatePage> = {
  "lau-family": {
    path: "/experiments/lau-family",
    title: "The Lau family record",
    object: "lau-family/index.html",
    secret: "LAU_FAMILY_PASSWORD",
  },
};

export const pageCookie = (slug: string) => `page_${slug}`;
export const pageScope = (slug: string) => `page:${slug}`;

export function passwordFor(page: PrivatePage, env: CloudflareEnv): string | undefined {
  return env[page.secret];
}

export async function hasPageSession(slug: string, env: CloudflareEnv): Promise<boolean> {
  const page = PRIVATE_PAGES[slug];
  if (!page) return false;
  const value = (await cookies()).get(pageCookie(slug))?.value;
  return verifySession(value, passwordFor(page, env), Date.now(), pageScope(slug));
}

export async function startPageSession(slug: string, password: string) {
  const session = await signSession(password, Date.now(), pageScope(slug));
  (await cookies()).set(pageCookie(slug), session.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    // "/" rather than the page's path, so /gate/<slug> can see it too.
    path: "/",
    maxAge: session.maxAge,
  });
}

/** For a private page's route.ts: the page if logged in, else off to its login. */
export async function servePrivatePage(slug: string): Promise<Response> {
  const page = PRIVATE_PAGES[slug];
  const { env } = await getCloudflareContext({ async: true });
  if (!(await hasPageSession(slug, env))) redirect(`/gate/${slug}`);

  const object = await env.PRIVATE_BUCKET.get(page.object);
  if (!object) return new Response("This page hasn't been uploaded yet.", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
