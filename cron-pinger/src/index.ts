/**
 * Small companion Worker for the home energy dashboard. It does two jobs:
 *
 * 1. CRON — fires the "Energy collector" GitHub Actions workflow every 5 min.
 *    GitHub Actions' own `schedule:` trigger never fired autonomously for this
 *    workflow (observed for 15+ min after creation, zero organic runs), a known
 *    GitHub-side problem with newly created scheduled workflows. Cloudflare's
 *    Cron Triggers are a separate, reliable system, so we drive it from here.
 *
 * 2. GROWATT PROXY — forwards the collector's Growatt API calls.
 *    Growatt's servers return 403 to GitHub Actions' datacenter IPs, which
 *    silently dropped the original 6.6 kW array from every automated reading
 *    (and understated derived house load with it). Cloudflare's egress IS
 *    accepted by Growatt (verified: HTTP 200), so the Python collector points
 *    `GrowattApi.server_url` at this proxy instead. All the Growatt protocol
 *    logic stays in the well-tested Python library — this only moves where the
 *    request egresses from.
 *
 *    Deliberately NOT a general-purpose proxy: the upstream host is hardcoded
 *    and every request must present the shared ingest secret.
 */

export interface Env {
  GH_TOKEN: string; // GitHub token with workflow dispatch permission
  INGEST_SECRET: string; // shared secret; gates the Growatt proxy
}

const REPO = "lauhuiyik/ericlau.io";
const WORKFLOW = "energy-collector.yml";
const GROWATT_ORIGIN = "https://openapi.growatt.com";
const PROXY_PREFIX = "/growatt-proxy/";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(PROXY_PREFIX)) {
      return proxyGrowatt(request, url, env);
    }

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

async function proxyGrowatt(request: Request, url: URL, env: Env): Promise<Response> {
  if (!env.INGEST_SECRET || request.headers.get("x-proxy-secret") !== env.INGEST_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  // Rebuild the upstream URL against the hardcoded Growatt origin, preserving
  // the path after the prefix plus any query string.
  const upstreamPath = url.pathname.slice(PROXY_PREFIX.length);
  const upstream = `${GROWATT_ORIGIN}/${upstreamPath}${url.search}`;

  const headers = new Headers();
  for (const name of ["content-type", "cookie", "user-agent", "accept", "accept-language"]) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }

  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const res = await fetch(upstream, init);

  // Pass the response back, including Set-Cookie so the Python session keeps
  // its Growatt login for subsequent calls.
  const out = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) out.append("set-cookie", c);
  if (setCookies.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) out.append("set-cookie", single);
  }
  const location = res.headers.get("location");
  if (location) out.set("location", location);

  return new Response(res.body, { status: res.status, headers: out });
}
