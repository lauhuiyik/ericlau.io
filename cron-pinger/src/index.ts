/**
 * Standalone Cloudflare Worker whose only job is to reliably fire the
 * "Energy collector" GitHub Actions workflow every 5 minutes.
 *
 * Why this exists: GitHub Actions' own `schedule:` cron for that workflow
 * did not fire autonomously for 15+ minutes after creation (confirmed via
 * direct observation, no organic runs beyond manual triggers) — a known
 * GitHub-side issue where newly created/updated scheduled workflows can take
 * a long time (or never reliably) get picked up by GitHub's scheduler.
 * Cloudflare's Cron Triggers are a separate, battle-tested system this site
 * already depends on being reliable — so this Worker uses ITS cron to call
 * GitHub's `workflow_dispatch` API directly, decoupling data collection from
 * GitHub's flaky internal scheduler entirely.
 */

export interface Env {
  GH_TOKEN: string; // a GitHub token with `repo`/`workflow` scope (or fine-grained Actions:write) for lauhuiyik/ericlau.io
}

const REPO = "lauhuiyik/ericlau.io";
const WORKFLOW = "energy-collector.yml";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env));
  },
  // Also expose a manual HTTP trigger for testing/debugging.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST to trigger the energy collector workflow manually.", { status: 200 });
    }
    const res = await dispatch(env);
    return new Response(JSON.stringify(res), {
      status: res.ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  },
};

async function dispatch(env: Env): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "ericlau-energy-cron-pinger",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
