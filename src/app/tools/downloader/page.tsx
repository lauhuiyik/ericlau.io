import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasToolsSession } from "@/lib/tools-auth";
import { DownloaderApp } from "./downloader-app";

/**
 * YouTube / SoundCloud / Instagram downloader, behind the tools password
 * (src/lib/tools-auth.ts; its ./api routes check it too).
 *
 * The downloading happens on the owner's home PC (downloader/agent/), which
 * polls /api/dl-agent/* for jobs and uploads the results to R2; this page
 * queues links and hands the finished files back. See src/lib/downloader.ts.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Downloader — Eric Lau",
  robots: { index: false, follow: false },
};

export default async function Page() {
  // `next dev` skips the password; production builds never take this branch.
  if (process.env.NODE_ENV !== "development") {
    const { env } = await getCloudflareContext({ async: true });
    if (!(await hasToolsSession(env))) redirect("/tools/login?next=/tools/downloader");
  }
  return <DownloaderApp />;
}
