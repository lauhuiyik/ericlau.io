import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getLatest } from "@/lib/energy";

export const dynamic = "force-dynamic";

/**
 * Newest reading, used by the dashboard's smart-poller to notice when fresh
 * data has landed.
 *
 * Reads D1 rather than a mirrored KV key. The KV mirror cost one write per
 * reading (~1,160/day) against a 1,000/day free allowance, and once exhausted
 * it took every other KV write down with it. D1 allows 5M row reads a day, and
 * the row is already there.
 */
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const latest = await getLatest(env.DB);
  return new Response(JSON.stringify(latest ?? null), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
