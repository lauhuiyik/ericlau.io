import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAccess } from "@/lib/cf-access";
import { FinanceApp } from "./finance-app";

/**
 * Personal spending tracker, behind Cloudflare Access.
 *
 * Two layers: the Access application in the Cloudflare dashboard must cover
 * /experiments/finance, AND this page verifies the Access token itself and
 * renders nothing but a locked notice without one (see src/lib/cf-access.ts).
 * So a gap in the dashboard config fails closed instead of going public.
 *
 * The server never sees any financial data: CSV exports are parsed in the
 * browser and kept in that browser's localStorage, and the personal profile
 * (merchant rules, allowances, pay, debts) is imported the same way. So there
 * is nothing to leak through logs, caches or this public repo.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finance — Eric Lau",
  robots: { index: false, follow: false },
};

export default async function Page() {
  // `next dev` has no Access in front of it; production builds never take this branch.
  if (process.env.NODE_ENV !== "development") {
    const { env } = await getCloudflareContext({ async: true });
    const gate = await checkAccess(await headers(), env);
    if (!gate.ok) return <Locked reason={gate.reason} />;
  }
  return <FinanceApp />;
}

function Locked({ reason }: { reason: string }) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center px-6 sm:px-12 py-24">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">Private</div>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">This page is locked.</h1>
      <p className="mt-4 max-w-md text-sm text-muted">
        It only opens behind the Cloudflare Access login. ({reason})
      </p>
    </div>
  );
}
