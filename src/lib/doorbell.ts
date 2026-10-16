import { mediaUrl } from "@/lib/media";

/**
 * Doorbells: tiny public JSON files in the ericlau-media bucket that the home
 * PC (and the energy cron Worker) watch instead of polling this Worker.
 *
 * Why: the site runs on the Workers Free plan, which allows ~10 ms of CPU per
 * request. Every request through Next.js costs about that, and a PC checking
 * in every 10 s used the allowance up, so visitors got Cloudflare's 1102
 * "exceeded resources" page. media.ericlau.io is served by R2 directly, so
 * reading these files costs the Worker nothing (and sits well inside R2's
 * free 10M reads a month).
 *
 *   status/dl.json      { ring }       the downloader agent wakes when `ring` moves
 *   status/energy.json  { liveUntil }  energy Live mode: collect every 5 min until then
 *
 * They hold timestamps only. Anyone can read them; only this Worker (and the
 * cron Worker) can write them. Never cached: `no-store`, and readers add a
 * `?t=` query so a future cache rule on media.ericlau.io can't serve them stale.
 */
export const DL_DOORBELL_KEY = "status/dl.json";
export const ENERGY_LIVE_KEY = "status/energy.json";
export const doorbellUrl = (key: string) => mediaUrl(key);

/** How long energy Live mode lasts once switched on, so it can't be left on by mistake. */
export const ENERGY_LIVE_MS = 2 * 60 * 60 * 1000;

async function putJson(bucket: R2Bucket, key: string, body: unknown) {
  await bucket.put(key, JSON.stringify(body), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store, max-age=0" },
  });
}

/** Wake the downloader agent: it notices within ~15 s and checks in. Never throws. */
export async function ringDownloader(bucket: R2Bucket, now = Date.now()) {
  try {
    await putJson(bucket, DL_DOORBELL_KEY, { ring: now });
  } catch (e) {
    console.error("doorbell", e);
  }
}

/** When energy Live mode ends (ms), or 0 if it's off. */
export async function getEnergyLiveUntil(bucket: R2Bucket, now = Date.now()): Promise<number> {
  try {
    const obj = await bucket.get(ENERGY_LIVE_KEY);
    if (!obj) return 0;
    const until = Number(((await obj.json()) as { liveUntil?: unknown }).liveUntil) || 0;
    return until > now ? until : 0;
  } catch {
    return 0;
  }
}

export async function setEnergyLiveUntil(bucket: R2Bucket, liveUntil: number) {
  await putJson(bucket, ENERGY_LIVE_KEY, { liveUntil });
}
