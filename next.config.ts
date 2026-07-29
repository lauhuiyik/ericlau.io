import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // OpenNext for Cloudflare needs the standalone output
  output: "standalone",
};

// Exposes the Cloudflare bindings (D1, KV) to `next dev` via getCloudflareContext().
// No-op in production builds.
initOpenNextCloudflareForDev();

export default nextConfig;
