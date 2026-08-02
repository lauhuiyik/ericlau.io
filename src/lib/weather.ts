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

export type WeatherNow = {
  /** Shortwave solar radiation reaching the ground, W/m². ~1000 is full sun. */
  radiation: number | null;
  cloudCover: number | null;
  temperature: number | null;
  isDay: boolean;
  sunrise: string | null;
  sunset: string | null;
};

export async function getWeatherNow(): Promise<WeatherNow | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=shortwave_radiation,cloud_cover,temperature_2m,is_day` +
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

/**
 * Compares reported solar against what the sky can physically support.
 *
 * The ceiling is rated capacity × (radiation / 1000 W/m²), with generous
 * headroom on top: panels beat their rating in cold bright conditions, and
 * Open-Meteo reports for a point rather than for these specific roof pitches.
 * The aim is to catch readings that are impossible, not to grade performance —
 * a false alarm here would train you to ignore it.
 */
export function checkSolarAgainstSky(
  solarKw: number | null,
  capacityKw: number,
  w: WeatherNow | null,
): SanityCheck | null {
  if (w == null || solarKw == null) return null;

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

  const ceiling = capacityKw * ((w.radiation ?? 0) / 1000);
  const sky =
    `${Math.round(w.radiation ?? 0)} W/m², ${Math.round(w.cloudCover ?? 0)}% cloud` +
    (w.temperature != null ? `, ${Math.round(w.temperature)}°C` : "");

  if (solarKw > ceiling * 1.35 + 0.5) {
    return {
      level: "bad",
      headline: `${solarKw.toFixed(1)} kW is more than this sky can produce`,
      detail: `At ${sky}, ${capacityKw} kW of panels could yield around ${ceiling.toFixed(1)} kW. Reported output is well above that, which points at a stuck or double-counted feed.`,
    };
  }
  // Only flag a shortfall in genuinely bright conditions — thin cloud makes the
  // point-forecast irradiance unreliable, and a quiet array in dim light is
  // normal rather than a fault.
  if ((w.radiation ?? 0) > 400 && solarKw < ceiling * 0.25) {
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
