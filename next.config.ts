import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext for Cloudflare needs the standalone output
  output: "standalone",
};

export default nextConfig;
