/**
 * Weather-based sanity checking for the solar figures.
 *
 * Every check the dashboard had compared derived numbers against each other,
 * which is why a stuck 4.5 kW reading survived a full arithmetic audit and was
 * only caught by a human noticing solar generation after dark. Sunlight is the
 * one input none of our own code can fake, so it makes a genuinely independent
 * reference.
 *
 * Open-Meteo needs no API key and no account, and answers fine from Cloudflare's
 * egress (unlike Growatt). Responses are cached at the edge for 15 minutes, so
 * this costs no KV writes and at most a handful of upstream calls an hour.
 */

/** Williams Landing, from the Growatt plant record (plant_id 549780). */
const LAT = -37.86;
const LON = 144.743;
const TZ = "Australia/Melbourne";

/**
 * Plane-of-array for the tilted-irradiance query. Exact roof pitches aren't on
 * record, so this assumes a typical ~20° north-facing roof (Open-Meteo azimuth:
 * 0 = south, 180 = north). The ceiling uses the larger of this and flat-ground
 * radiation, so a wrong guess only makes the check more lenient, never stricter.
 */
const TILT = 20;
const AZIMUTH = 180;

export type WeatherNow = {
  /** Shortwave solar radiation reaching the ground, W/m². ~1000 is full sun. */
  radiation: number | null;
  /** Radiation on a tilted, north-facing panel, W/m². Beats `radiation` most of the day. */
  tiltedRadiation: number | null;
  cloudCover: number | null;
  temperature: number | null;
  isDay: boolean;
  sunrise: string | null;
  sunset: string | null;
};

export async function getWeatherNow(): Promise<WeatherNow | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=shortwave_radiation,global_tilted_irradiance,cloud_cover,temperature_2m,is_day` +
    `&tilt=${TILT}&azimuth=${AZIMUTH}` +
    `&daily=sunrise,sunset&timezone=${encodeURIComponent(TZ)}&forecast_days=1`;
  try {
    const res = await fetch(url, {
      // Edge-cached: the sun doesn't move fast enough to justify per-request calls.
      cf: { cacheTtl: 900, cacheEverything: true },
      headers: { "user-agent": "ericlau-energy/1.0" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      current?: {
        shortwave_radiation?: number;
        global_tilted_irradiance?: number;
        cloud_cover?: number;
        temperature_2m?: number;
        is_day?: number;
      };
      daily?: { sunrise?: string[]; sunset?: string[] };
    };
    const c = j.current;
    if (!c) return null;
    return {
      radiation: c.shortwave_radiation ?? null,
      tiltedRadiation: c.global_tilted_irradiance ?? null,
      cloudCover: c.cloud_cover ?? null,
      temperature: c.temperature_2m ?? null,
      isDay: c.is_day === 1,
      sunrise: j.daily?.sunrise?.[0]?.slice(11) ?? null,
      sunset: j.daily?.sunset?.[0]?.slice(11) ?? null,
    };
  } catch {
    return null;
  }
}

export type SanityCheck = {
  level: "ok" | "warn" | "bad";
  headline: string;
  detail: string;
};

/** How long output must sit above the ceiling before it's flagged. */
const SUSTAINED_MIN = 10;

/**
 * Compares reported solar against what the sky can physically support.
 *
 * The ceiling is rated capacity × (irradiance / 1000 W/m²), using the larger of
 * tilted-panel and flat-ground irradiance, with generous headroom on top:
 * panels beat their rating in cold bright conditions, and broken cloud
 * briefly focuses extra light onto the array ("cloud-edge enhancement") that
 * a 15-minute model average can't see. So a reading above the ceiling is only
 * flagged when it holds for SUSTAINED_MIN minutes, and only called "stuck" when
 * the value genuinely isn't changing. The aim is to catch impossible readings,
 * not to grade performance — a false alarm here trains you to ignore it.
 *
 * `recent` is the last ~15 minutes of total solar readings, oldest first, as
 * {ts: unix seconds, kw}; the newest entry is the figure being checked.
 */
export function checkSolarAgainstSky(
  recent: { ts: number; kw: number }[],
  capacityKw: number,
  w: WeatherNow | null,
): SanityCheck | null {
  const latest = recent[recent.length - 1];
  if (w == null || latest == null) return null;
  const solarKw = latest.kw;
  const unchanged = recent.length >= 3 && recent.every((x) => Math.abs(x.kw - solarKw) < 0.005);

  // Night is the unambiguous case: no sun, so any real output is impossible.
  if (!w.isDay || (w.radiation ?? 0) < 5) {
    if (solarKw > 0.1) {
      return {
        level: "bad",
        headline: `Reporting ${solarKw.toFixed(1)} kW after dark`,
        detail:
          `The sun set at ${w.sunset ?? "sunset"} and irradiance is ` +
          `${Math.round(w.radiation ?? 0)} W/m². Solar output is not physically possible ` +
          `right now, so an inverter feed is almost certainly stuck on a stale value.`,
      };
    }
    return {
      level: "ok",
      headline: "Dark — no generation expected",
      detail: `Sunset ${w.sunset ?? "—"}, sunrise ${w.sunrise ?? "—"}. Both arrays reading zero, as they should.`,
    };
  }

  const irradiance = Math.max(w.radiation ?? 0, w.tiltedRadiation ?? 0);
  const ceiling = capacityKw * (irradiance / 1000);
  const limit = ceiling * 1.35 + 0.5;
  const sky =
    `${Math.round(irradiance)} W/m² on the panels, ${Math.round(w.cloudCover ?? 0)}% cloud` +
    (w.temperature != null ? `, ${Math.round(w.temperature)}°C` : "");

  if (solarKw > limit) {
    // Minutes the output has stayed above the limit, counting back from now.
    let since = latest.ts;
    for (let i = recent.length - 1; i >= 0 && recent[i].kw > limit; i--) since = recent[i].ts;
    const heldMin = (latest.ts - since) / 60;

    if (unchanged && heldMin >= SUSTAINED_MIN) {
      return {
        level: "bad",
        headline: `Stuck at ${solarKw.toFixed(1)} kW`,
        detail: `Solar has read exactly ${solarKw.toFixed(2)} kW for ${Math.round(heldMin)} minutes, above the ~${ceiling.toFixed(1)} kW that ${sky} supports. An inverter feed is likely repeating a stale value.`,
      };
    }
    if (heldMin >= SUSTAINED_MIN) {
      return {
        level: "warn",
        headline: `${solarKw.toFixed(1)} kW, above the sky estimate for ${Math.round(heldMin)} min`,
        detail: `At ${sky}, ${capacityKw} kW of panels would be expected to make around ${ceiling.toFixed(1)} kW. Readings are still moving, so the feed isn't stuck — this is more likely the weather model lagging a clearing sky, but worth a look if it persists.`,
      };
    }
    return {
      level: "ok",
      headline: `${solarKw.toFixed(1)} kW — a brief burst above the sky estimate`,
      detail: `At ${sky} the model expects around ${ceiling.toFixed(1)} kW. Short spikes above that are normal under broken cloud, when sunlight reflecting off cloud edges briefly boosts the panels.`,
    };
  }
  // Only flag a shortfall in genuinely bright conditions — thin cloud makes the
  // point-forecast irradiance unreliable, and a quiet array in dim light is
  // normal rather than a fault.
  if (irradiance > 400 && solarKw < ceiling * 0.25) {
    return {
      level: "warn",
      headline: `Only ${solarKw.toFixed(1)} kW in decent sun`,
      detail: `At ${sky} you'd expect roughly ${ceiling.toFixed(1)} kW. Worth checking whether an array or its poller has dropped out — shading and dirt aside.`,
    };
  }
  return {
    level: "ok",
    headline: `${solarKw.toFixed(1)} kW is consistent with the sky`,
    detail: `${sky} — around ${ceiling.toFixed(1)} kW is the most ${capacityKw} kW of panels could do in this light.`,
  };
}
