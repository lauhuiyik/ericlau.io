import type { Metadata } from "next";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireOwner } from "@/lib/finance-auth";
import { DownloaderApp } from "./downloader-app";

/**
 * YouTube / SoundCloud / Instagram downloader, behind Cloudflare Access.
 *
 * The downloading happens on the owner's home PC (downloader/agent/), which
 * polls /api/dl-agent/* for jobs and uploads the results to R2; this page
 * queues links and hands the finished files back. See src/lib/downloader.ts.
 *
 * Same two layers as /experiments/finance: the Access application must cover
 * /tools/downloader, AND this page (and its ./api routes) verify the
 * Access token and owner email themselves, so a dashboard gap fails closed.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Downloader — Eric Lau",
  robots: { index: false, follow: false },
};

export default async function Page() {
  // `next dev` has no Access in front of it; production builds never take this branch.
  if (process.env.NODE_ENV !== "development") {
    const { env } = await getCloudflareContext({ async: true });
    const gate = await requireOwner(await headers(), env);
    if (!gate.ok) return <Locked reason={gate.reason} />;
  }
  return <DownloaderApp />;
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
