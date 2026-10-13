// Augment the Cloudflare env with non-binding vars/secrets the Worker reads at runtime.
// (Bindings like DB/ENERGY_KV are generated into worker-configuration.d.ts by `wrangler types`.)
declare global {
  interface CloudflareEnv extends Cloudflare.Env {
    /** Shared secret the Python collector uses to authenticate to POST /api/ingest. */
    INGEST_SECRET?: string;
    /** Tesla Fleet API app credentials (developer.tesla.com). */
    TESLA_CLIENT_ID?: string;
    TESLA_CLIENT_SECRET?: string;
    /** Cloudflare Access team domain, e.g. "<team>.cloudflareaccess.com" (see src/lib/cf-access.ts). */
    CF_ACCESS_TEAM_DOMAIN?: string;
    /** AUD tag of the Access application covering /experiments/finance. */
    CF_ACCESS_AUD?: string;
  }
}

export {};
