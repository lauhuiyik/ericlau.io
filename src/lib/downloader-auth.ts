import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type AgentRow, agentFromRequest, crossSite, json } from "@/lib/downloader";
import { hasToolsSession } from "@/lib/tools-auth";

/**
 * Gates for /tools/downloader's two kinds of caller.
 *
 * The page and its API (/tools/downloader/api/*) need the tools password
 * session (src/lib/tools-auth.ts); with no TOOLS_PASSWORD set they refuse
 * everyone. The home-PC agent can't log in, so /api/dl-agent/* authenticates
 * with its connection key instead.
 */

type Env = CloudflareEnv;

/** For the page API. Writes also have to come from the page itself. */
export async function openForTools(
  request: Request,
  { write = false } = {},
): Promise<{ env: Env } | { denied: Response }> {
  const { env } = await getCloudflareContext({ async: true });
  // `next dev` skips the password; production builds never take this branch.
  if (process.env.NODE_ENV !== "development" && !(await hasToolsSession(env))) {
    return { denied: json({ error: "login required" }, 401) };
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
