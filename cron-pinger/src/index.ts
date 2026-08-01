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
  DB?: D1Database; // same database the main site binds
}

const REPO = "lauhuiyik/ericlau.io";
const WORKFLOW = "energy-collector.yml";
const GROWATT_KV_KEY = "growatt_latest";
/** Last Growatt attempt, success or failure, so a silent failure is visible
 *  without tailing the Worker. Diagnostics only — nothing reads it to decide
 *  behaviour. */
const GROWATT_DIAG_KV_KEY = "growatt_diag";
/** How stale the newest reading may get before it counts as a stall. The
 * collector runs every 5 min, so this tolerates three missed cycles before
 * crying wolf. */
const STALE_AFTER_SEC = 20 * 60;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // All independent: none of these may stop the others running.
    ctx.waitUntil(dispatch(env).then((r) => console.log("dispatch", JSON.stringify(r))));
    ctx.waitUntil(refreshGrowatt(env).then((r) => console.log("growatt", JSON.stringify(r))));
    ctx.waitUntil(checkFreshness(env).then((r) => console.log("freshness", JSON.stringify(r))));
  },

  // Manual trigger, handy for testing or forcing a fresh reading.
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST to trigger the energy collector workflow manually.", { status: 200 });
    }
    const [gh, growatt, freshness] = await Promise.all([
      dispatch(env),
      refreshGrowatt(env),
      checkFreshness(env),
    ]);
    return new Response(JSON.stringify({ dispatch: gh, growatt, freshness }), {
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
  // Records what happened either way. Growatt failing silently is exactly how
  // this went unnoticed for a day: the error was returned but never read.
  //
  // Only writes when the outcome CHANGES. KV allows 1,000 writes a day against
  // 100,000 reads, so a diagnostic written every 5-minute cycle (288/day) is a
  // third of the entire write budget spent on telling us nothing new. Reading
  // first to compare costs essentially nothing.
  const diag = async (d: Record<string, unknown>) => {
    try {
      const next = JSON.stringify(d);
      const prevRaw = await env.ENERGY_KV!.get(GROWATT_DIAG_KV_KEY);
      if (prevRaw) {
        const { at_ts: _ignored, ...prev } = JSON.parse(prevRaw) as Record<string, unknown>;
        if (JSON.stringify(prev) === next) return; // unchanged, don't spend a write
      }
      await env.ENERGY_KV!.put(
        GROWATT_DIAG_KV_KEY,
        JSON.stringify({ ...d, at_ts: Math.floor(Date.now() / 1000) }),
      );
    } catch {
      // diagnostics must never break collection
    }
  };

  type Body = {
    error_code?: number;
    error_msg?: string;
    data?: { current_power?: number; today_energy?: string; last_update_time?: string };
  };

  try {
    // Growatt answers 10011 error_permission_denied depending on which IP the
    // request leaves from — the same token and plant succeed from a home
    // connection. Cloudflare's egress is usually rejected but not always (it
    // worked at 10:31 and 21:04 today), so retry a few times: attempts are
    // cheap and a rejected call doesn't appear to consume quota.
    //
    // Spaced ~2s to stay clear of 10012 error_frequently_access, and the loop
    // stops the moment one succeeds.
    const attempts: { status: number; error_code?: number; error_msg?: string }[] = [];
    let body: Body | null = null;
    let lastStatus = 0;

    for (let i = 0; i < 3; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(
        `https://openapi.growatt.com/v1/plant/data?plant_id=${encodeURIComponent(env.GROWATT_PLANT_ID)}`,
        { headers: { token: env.GROWATT_API_TOKEN, "user-agent": "ericlau-energy/1.0" } },
      );
      lastStatus = res.status;
      // Read as text first: a block page or gateway error is HTML, and
      // res.json() would throw before we ever saw what it actually said.
      const raw = await res.text();
      let parsed: Body;
      try {
        parsed = JSON.parse(raw) as Body;
      } catch {
        attempts.push({ status: res.status, error_msg: `non-JSON: ${raw.slice(0, 80)}` });
        continue;
      }
      attempts.push({
        status: res.status,
        error_code: parsed.error_code,
        error_msg: parsed.error_msg,
      });
      if (parsed.error_code === 0 && parsed.data) {
        body = parsed;
        break;
      }
      // Rate-limited: backing off further won't help within this cycle.
      if (parsed.error_code === 10012) break;
    }

    if (!body) {
      await diag({ ok: false, stage: "api", status: lastStatus, attempts });
      const last = attempts[attempts.length - 1];
      return {
        ok: false,
        detail: `growatt failed after ${attempts.length} attempts: error_code=${last?.error_code} msg=${last?.error_msg}`,
      };
    }
    const num = (v: unknown): number | null => {
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const snapshot: GrowattSnapshot = {
      // NOTE: plant/data reports current_power in kW. plant/list reports the
      // same value in WATTS — don't mix them up.
      solar_old_kw: num(body.data!.current_power),
      solar_old_kwh_today: num(body.data!.today_energy),
      last_update_time: body.data!.last_update_time ?? null,
      fetched_ts: Math.floor(Date.now() / 1000),
    };
    await env.ENERGY_KV.put(GROWATT_KV_KEY, JSON.stringify(snapshot));
    await diag({ ok: true, stage: "ok", attempts: attempts.length, ...snapshot });
    return { ok: true, detail: `${snapshot.solar_old_kw} kW / ${snapshot.solar_old_kwh_today} kWh` };
  } catch (e) {
    await diag({ ok: false, stage: "throw", error: String(e) });
    return { ok: false, detail: String(e) };
  }
}

/**
 * Watchdog for the failure mode that nothing else can catch: collection
 * stopping entirely and quietly. That's already happened once — an Anker
 * lockout killed data for two days and was only noticed by chance.
 *
 * The collector itself exits non-zero when a run gathers nothing, which makes
 * GitHub email a failed-run notification. But that only helps while runs still
 * happen; if dispatch stops, there are no runs to fail. So this checks the
 * newest reading's age independently.
 *
 * Alerts by opening a GitHub issue, which GitHub then emails about. That's a
 * deliberate choice over wiring up email directly: it needs no new account, no
 * API key, and no DNS/MX changes to a domain that carries real mail. The issue
 * is deduplicated and closed automatically once data returns, so a long outage
 * produces one notification rather than one every five minutes.
 */
async function checkFreshness(env: Env): Promise<{ ok: boolean; detail: string }> {
  try {
    // Straight from D1. See the wrangler.jsonc note for why this isn't a KV
    // read or a fetch of the site's own endpoint.
    if (!env.DB) return { ok: false, detail: "no D1 binding" };
    const latest = await env.DB.prepare(
      "SELECT ts, local_time FROM readings ORDER BY ts DESC LIMIT 1",
    ).first<{ ts: number; local_time: string }>();
    if (!latest) return { ok: false, detail: "no reading yet" };
    if (!latest.ts) return { ok: false, detail: "reading has no timestamp" };

    const ageSec = Math.floor(Date.now() / 1000) - latest.ts;
    const stale = ageSec > STALE_AFTER_SEC;

    // Dedupe against GitHub rather than KV. KV is eventually consistent, so two
    // invocations close together can both read "no open alert" and both file
    // one — which is exactly what happened in testing. GitHub is strongly
    // consistent and is where the issue actually lives, so ask it.
    const openIssue = await findOpenAlert(env);

    if (stale && !openIssue) {
      const mins = Math.floor(ageSec / 60);
      const num = await createIssue(
        env,
        `Energy collector stalled — no reading for ${mins} min`,
        [
          `The newest reading is **${mins} minutes old** (last sample ${latest.local_time ?? "unknown"}).`,
          `Expected a new one every ~5 minutes.`,
          ``,
          `Worth checking, in the order these have actually gone wrong before:`,
          `- Recent runs of the \`Energy collector\` workflow, for an Anker auth error such as a CAPTCHA prompt`,
          `- Whether the \`ericlau-energy-cron-pinger\` Worker is still firing its cron`,
          `- Whether the GitHub token the Worker dispatches with is still valid`,
          ``,
          `This issue closes itself once readings resume.`,
        ].join("\n"),
      );
      return { ok: false, detail: `stale ${mins}m — opened issue #${num}` };
    }

    if (!stale && openIssue) {
      await closeIssue(env, openIssue, `Readings resumed — newest is ${ageSec}s old.`);
      return { ok: true, detail: `recovered, closed issue #${openIssue}` };
    }

    return { ok: !stale, detail: `${ageSec}s old` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

/**
 * Oldest open alert issue, or null — and tidies up any duplicates.
 *
 * Checking-then-creating is inherently racy: two invocations can both see "no
 * open alert" and both file one (reproduced by firing two requests at the same
 * instant). With a 5-minute cron that effectively never happens, so rather than
 * add locking this keeps the oldest issue and closes any extras, which
 * self-heals on the next cycle.
 */
async function findOpenAlert(env: Env): Promise<number | null> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/issues?state=open&labels=energy-alert&per_page=20&sort=created&direction=asc`,
    { headers: ghHeaders(env) },
  );
  if (!res.ok) return null;
  const issues = (await res.json()) as { number?: number }[];
  const numbers = issues.map((i) => i.number).filter((n): n is number => typeof n === "number");
  if (numbers.length === 0) return null;
  for (const dup of numbers.slice(1)) {
    await closeIssue(env, dup, `Duplicate of #${numbers[0]} — closing.`);
  }
  return numbers[0];
}

async function createIssue(env: Env, title: string, body: string): Promise<number | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: ghHeaders(env),
    body: JSON.stringify({ title, body, labels: ["energy-alert"] }),
  });
  if (!res.ok) return null;
  const issue = (await res.json()) as { number?: number };
  return issue.number ?? null;
}

async function closeIssue(env: Env, number: number, comment: string): Promise<void> {
  await fetch(`https://api.github.com/repos/${REPO}/issues/${number}/comments`, {
    method: "POST",
    headers: ghHeaders(env),
    body: JSON.stringify({ body: comment }),
  });
  await fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
    method: "PATCH",
    headers: ghHeaders(env),
    body: JSON.stringify({ state: "closed" }),
  });
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    authorization: `Bearer ${env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "ericlau-energy-cron-pinger",
    "content-type": "application/json",
  };
}
