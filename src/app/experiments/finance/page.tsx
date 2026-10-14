import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireOwner } from "@/lib/finance-auth";
import { FinanceApp } from "./finance-app";

/**
 * Personal spending tracker, behind Cloudflare Access.
 *
 * Two layers: the Access application in the Cloudflare dashboard must cover
 * /experiments/finance, AND this page verifies the Access token itself, and
 * that it belongs to the owner, rendering nothing but a locked notice
 * otherwise (src/lib/finance-auth.ts). So a gap in the dashboard config fails
 * closed instead of going public.
 *
 * The server never sees any plaintext financial data: CSV exports are parsed
 * in the browser, encrypted there with the owner's passphrase and saved as
 * ciphertext to the vault (./vault/route.ts). Nothing readable can leak
 * through logs, caches, the database or this public repo.
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
    const gate = await requireOwner(await headers(), env);
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
