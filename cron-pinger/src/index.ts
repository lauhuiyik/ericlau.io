/**
 * Small companion Worker for the home energy dashboard.
 *
 * Its job: fire the "Energy collector" GitHub Actions workflow every 5 minutes.
 * GitHub Actions' own `schedule:` trigger never fired autonomously for that
 * workflow (observed for 15+ minutes after creation — zero organic runs, only
 * manual dispatches), a known GitHub-side problem where newly created
 * scheduled workflows can go unrecognised by their scheduler. Cloudflare's
 * Cron Triggers are a separate, reliable system, so the schedule lives here
 * and GitHub Actions is only ever invoked explicitly.
 *
 * Verified working: organic runs appear on a clean 5-minute grid.
 */

export interface Env {
  GH_TOKEN: string; // GitHub token with workflow dispatch permission
}

const REPO = "lauhuiyik/ericlau.io";
const WORKFLOW = "energy-collector.yml";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env));
  },

  // Manual trigger, handy for testing or forcing a fresh reading.
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
  return { ok: res.ok, status: res.status, body: await res.text() };
}
