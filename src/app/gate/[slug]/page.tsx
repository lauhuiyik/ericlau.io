import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { clearFailures, lockedOutFor, passwordMatches, recordFailure } from "@/lib/tools-auth";
import { PRIVATE_PAGES, hasPageSession, passwordFor, startPageSession } from "@/lib/private-pages";
import { SiteFooter } from "@/app/_components/site-footer";

/** The password gate for one private page (see src/lib/private-pages.ts). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private — Eric Lau",
  robots: { index: false, follow: false },
};

async function login(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug") ?? "");
  const page = PRIVATE_PAGES[slug];
  if (!page) notFound();
  const guess = String(formData.get("password") ?? "");
  const { env } = await getCloudflareContext({ async: true });
  const password = passwordFor(page, env);
  // Shares the tools gate's per-IP throttle.
  const db = env.DL_DB;
  const ip = (await headers()).get("cf-connecting-ip") ?? "unknown";

  if (await lockedOutFor(db, ip)) redirect(`/gate/${slug}?error=locked`);
  if (!(await passwordMatches(guess, password))) {
    await recordFailure(db, ip);
    redirect(`/gate/${slug}?error=1`);
  }

  await clearFailures(db, ip);
  await startPageSession(slug, password!);
  redirect(page.path);
}

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const { error } = await searchParams;
  const page = PRIVATE_PAGES[slug];
  if (!page) notFound();
  const { env } = await getCloudflareContext({ async: true });
  if (await hasPageSession(slug, env)) redirect(page.path);
  const configured = !!passwordFor(page, env);
  const minutes = error === "locked" ? await lockedOutFor(env.DL_DB, (await headers()).get("cf-connecting-ip") ?? "unknown") : 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Eric Lau
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center px-6 sm:px-12 max-w-md">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">Private</div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[0.9] mb-10">
          Password required
        </h1>

        {configured ? (
          <form action={login} className="flex flex-col gap-4">
            <input type="hidden" name="slug" value={slug} />
            <input
              type="password"
              name="password"
              placeholder="Enter password"
              autoFocus
              autoComplete="current-password"
              className="bg-transparent border border-rule rounded-none px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-foreground transition-colors"
            />
            {error === "locked" ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Too many wrong attempts. Try again in {Math.max(1, minutes)} min.
              </p>
            ) : error ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Incorrect password</p>
            ) : null}
            <button
              type="submit"
              className="border border-rule px-4 py-3 text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-foreground hover:border-foreground transition-colors text-left"
            >
              Enter →
            </button>
          </form>
        ) : (
          <p className="text-sm text-muted">This page is locked: no password has been set ({page.secret}).</p>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
