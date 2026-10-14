/**
 * Self-hosted media: the R2 bucket ericlau-media, served from its custom
 * domain (cached at Cloudflare's edge; no egress fees).
 *
 * Upload with:  npx wrangler r2 object put ericlau-media/<path> --file <file> --remote
 * Files are cached for 30 days, so to replace one, upload it under a new
 * name (or purge media.ericlau.io/<path> in the Cloudflare dashboard).
 */
export const MEDIA_BASE = "https://media.ericlau.io";

export const mediaUrl = (path: string) => `${MEDIA_BASE}/${path.replace(/^\/+/, "")}`;
