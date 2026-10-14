// Augment the Cloudflare env with non-binding vars/secrets the Worker reads at runtime.
// (Bindings like DB/ENERGY_KV are generated into worker-configuration.d.ts by `wrangler types`.)
declare global {
  interface CloudflareEnv extends Cloudflare.Env {
    /** Shared secret the Python collector uses to authenticate to POST /api/ingest. */
    INGEST_SECRET?: string;
    /** Tesla Fleet API app credentials (developer.tesla.com). */
    TESLA_CLIENT_ID?: string;
    TESLA_CLIENT_SECRET?: string;
    /** Comma-separated emails allowed into /experiments/finance (see src/lib/finance-auth.ts). */
    FINANCE_ALLOWED_EMAILS?: string;
    /** The password for /tools/* (see src/lib/tools-auth.ts). Unset = tools locked. */
    TOOLS_PASSWORD?: string;
  }
}

export {};
