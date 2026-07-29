import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

// Lightweight, cheap read of the latest snapshot from KV — used by the
// dashboard's smart-poller to detect when a fresh reading has landed.
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const raw = await env.ENERGY_KV.get("latest");
  return new Response(raw ?? "null", {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
