import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// /experiments/finance holds the owner's (encrypted) finance data: no framing,
// no talking to other origins, no caching. No script-src: Cloudflare injects
// its own inline bot-detection script into HTML pages.
const FINANCE_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'",
  },
  // Pages without this same header (every other page on the site) get no window handle on this one.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  // OpenNext for Cloudflare needs the standalone output
  output: "standalone",
  async headers() {
    return [
      { source: "/experiments/finance", headers: FINANCE_HEADERS },
      { source: "/experiments/finance/:path*", headers: FINANCE_HEADERS },
    ];
  },
};

// Exposes the Cloudflare bindings (D1, KV) to `next dev` via getCloudflareContext().
// No-op in production builds.
initOpenNextCloudflareForDev();

export default nextConfig;
