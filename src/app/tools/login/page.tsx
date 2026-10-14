import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  TOOLS_COOKIE,
  clearFailures,
  hasToolsSession,
  lockedOutFor,
  passwordMatches,
  recordFailure,
  safeNext,
  signSession,
} from "@/lib/tools-auth";
import { SiteFooter } from "@/app/_components/site-footer";

/** The password gate for /tools/* (see src/lib/tools-auth.ts). */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tools — Eric Lau",
  robots: { index: false, follow: false },
};

async function login(formData: FormData) {
  "use server";
  const next = safeNext(formData.get("next"));
  const password = String(formData.get("password") ?? "");
  const { env } = await getCloudflareContext({ async: true });
  const db = env.DL_DB;
  const ip = (await headers()).get("cf-connecting-ip") ?? "unknown";

  if (await lockedOutFor(db, ip)) redirect(`/tools/login?error=locked&next=${encodeURIComponent(next)}`);
  if (!(await passwordMatches(password, env.TOOLS_PASSWORD))) {
    await recordFailure(db, ip);
    redirect(`/tools/login?error=1&next=${encodeURIComponent(next)}`);
  }

  await clearFailures(db, ip);
  const session = await signSession(env.TOOLS_PASSWORD!);
  (await cookies()).set(TOOLS_COOKIE, session.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/tools",
    maxAge: session.maxAge,
  });
  redirect(next);
}

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function Page({ searchParams }: Props) {
  const { error, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const { env } = await getCloudflareContext({ async: true });
  if (await hasToolsSession(env)) redirect(next);
  const configured = !!env.TOOLS_PASSWORD;
  const minutes = error === "locked" ? await lockedOutFor(env.DL_DB, (await headers()).get("cf-connecting-ip") ?? "unknown") : 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12">
        <Link
          href="/tools"
          className="font-mono text-xs uppercase tracking-[0.18em] text-muted hover:text-foreground transition-colors"
        >
          ← Tools
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center px-6 sm:px-12 max-w-md">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">Private</div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[0.9] mb-10">
          Password required
        </h1>

        {configured ? (
          <form action={login} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next} />
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
          <p className="text-sm text-muted">
            The tools are locked: no password has been set (TOOLS_PASSWORD).
          </p>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
