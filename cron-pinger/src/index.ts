/**
 * Companion Worker for the home energy dashboard. Two jobs, both on its
 * 5-minute Cron Trigger:
 *
 * 1. DISPATCH — fires the "Energy collector" GitHub Actions workflow.
 *    GitHub Actions' own `schedule:` trigger never fired autonomously for that
 *    workflow (observed 15+ min, zero organic runs), and leaving it enabled also
 *    meant "pausing the collector" didn't actually pause anything. So the
 *    schedule lives here and the workflow is dispatch-only.
 *
 * 2. GROWATT — reads the original array and stashes it in KV for /api/ingest to
 *    merge into the next reading.
 *
 *    Why here rather than in the collector: Growatt refuses datacenter IPs.
 *    From GitHub Actions the legacy endpoint 403s and the official V1 token API
 *    returns 10011 error_permission_denied, while the identical call from a home
 *    IP succeeds. Cloudflare's egress, however, IS accepted — verified against
 *    the real plant (error_code 0, current_power 3.57 kW, today_energy 4.4 kWh).
 *    The V1 API is plain REST with a token header (no login, no session, no
 *    crypto), so it ports here trivially — unlike the legacy endpoint, which is
 *    why an earlier proxy attempt was abandoned.
 */

export interface Env {
  GH_TOKEN: string; // GitHub token with workflow dispatch permission
  GROWATT_API_TOKEN?: string;
  GROWATT_PLANT_ID?: string;
  ENERGY_KV?: KVNamespace; // same namespace the main site binds
}

const REPO = "lauhuiyik/ericlau.io";
const WORKFLOW = "energy-collector.yml";
const GROWATT_KV_KEY = "growatt_latest";

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Independent: a Growatt hiccup must not stop the collector being dispatched.
    ctx.waitUntil(dispatch(env));
    ctx.waitUntil(refreshGrowatt(env));
  },

  // Manual trigger, handy for testing or forcing a fresh reading.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST to trigger the energy collector workflow manually.", { status: 200 });
    }
    const [gh, growatt] = await Promise.all([dispatch(env), refreshGrowatt(env)]);
    return new Response(JSON.stringify({ dispatch: gh, growatt }), {
      status: gh.ok ? 200 : 502,
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

type GrowattSnapshot = {
  solar_old_kw: number | null;
  solar_old_kwh_today: number | null;
  /** Growatt's own last-update stamp, so staleness is visible. */
  last_update_time: string | null;
  /** When we fetched it (unix seconds) — /api/ingest ignores stale entries. */
  fetched_ts: number;
};

async function refreshGrowatt(env: Env): Promise<{ ok: boolean; detail: string }> {
  if (!env.GROWATT_API_TOKEN || !env.GROWATT_PLANT_ID || !env.ENERGY_KV) {
    return { ok: false, detail: "growatt not configured" };
  }
  try {
    const res = await fetch(
      `https://openapi.growatt.com/v1/plant/data?plant_id=${encodeURIComponent(env.GROWATT_PLANT_ID)}`,
      { headers: { token: env.GROWATT_API_TOKEN, "user-agent": "ericlau-energy/1.0" } },
    );
    const body = (await res.json()) as {
      error_code?: number;
      error_msg?: string;
      data?: { current_power?: number; today_energy?: string; last_update_time?: string };
    };
    // 10012 is 'error_frequently_access' (rate limit) — expected occasionally,
    // and no reason to clobber the last good value, so just report and leave KV.
    if (body.error_code !== 0 || !body.data) {
      return { ok: false, detail: `growatt error_code=${body.error_code} msg=${body.error_msg}` };
    }
    const num = (v: unknown): number | null => {
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const snapshot: GrowattSnapshot = {
      // NOTE: plant/data reports current_power in kW. plant/list reports the
      // same value in WATTS — don't mix them up.
      solar_old_kw: num(body.data.current_power),
      solar_old_kwh_today: num(body.data.today_energy),
      last_update_time: body.data.last_update_time ?? null,
      fetched_ts: Math.floor(Date.now() / 1000),
    };
    await env.ENERGY_KV.put(GROWATT_KV_KEY, JSON.stringify(snapshot));
    return { ok: true, detail: `${snapshot.solar_old_kw} kW / ${snapshot.solar_old_kwh_today} kWh` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
