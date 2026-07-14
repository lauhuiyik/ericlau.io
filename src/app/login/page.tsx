import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

async function authenticate(formData: FormData) {
  "use server";
  const password = formData.get("password") as string;
  const next = (formData.get("next") as string) || "/";
  const sitePassword = process.env.SITE_PASSWORD;

  if (sitePassword && password === sitePassword) {
    const cookieStore = await cookies();
    cookieStore.set("site_auth", sitePassword, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });
    redirect(next);
  }

  redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
}

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { error, next } = await searchParams;

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
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted mb-6">
          Private
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] leading-[0.9] mb-10">
          Password required
        </h1>

        <form action={authenticate} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? "/"} />
          <input
            type="password"
            name="password"
            placeholder="Enter password"
            autoFocus
            autoComplete="current-password"
            className="bg-transparent border border-rule rounded-none px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-foreground transition-colors"
          />
          {error && (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Incorrect password
            </p>
          )}
          <button
            type="submit"
            className="border border-rule px-4 py-3 text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-foreground hover:border-foreground transition-colors text-left"
          >
            Enter →
          </button>
        </form>
      </section>

      <footer className="border-t border-rule px-6 sm:px-12 py-8 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        <Link href="/" className="hover:text-foreground transition-colors">
          ← Back to index
        </Link>
      </footer>
    </div>
  );
}
