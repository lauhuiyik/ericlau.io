import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireOwner } from "@/lib/finance-auth";
import { type AgentRow, agentFromRequest, crossSite, json } from "@/lib/downloader";

/**
 * Gates for /tools/downloader's two kinds of caller.
 *
 * The page and its API (/tools/downloader/api/*) are covered by the
 * Cloudflare Access application AND re-check the Access token + owner email
 * here (the same rule as /experiments/finance), so a dashboard slip fails
 * closed. The home-PC agent can't do the Access login, so /api/dl-agent/* is
 * outside Access and authenticates with its connection key instead.
 */

type Env = CloudflareEnv;

/** For the gated page API. Writes also have to come from the page itself. */
export async function openForOwner(
  request: Request,
  { write = false } = {},
): Promise<{ env: Env } | { denied: Response }> {
  const { env } = await getCloudflareContext({ async: true });
  // `next dev` has no Access in front of it; production builds never take this branch.
  if (process.env.NODE_ENV !== "development") {
    const owner = await requireOwner(request.headers, env);
    if (!owner.ok) return { denied: json({ error: "forbidden", reason: owner.reason }, 403) };
  }
  if (write) {
    const bad = crossSite(request);
    if (bad) return { denied: json({ error: bad }, 403) };
  }
  return { env };
}

/** For /api/dl-agent/*: the PC identified by its Bearer connection key. */
export async function openForAgent(request: Request): Promise<{ env: Env; agent: AgentRow } | { denied: Response }> {
  const { env } = await getCloudflareContext({ async: true });
  const agent = await agentFromRequest(request, env.DL_DB);
  if (!agent) return { denied: json({ error: "unauthorized" }, 401) };
  return { env, agent };
}
