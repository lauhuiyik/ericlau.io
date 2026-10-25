import { servePrivatePage } from "@/lib/private-pages";

/** The Lau family record (劉氏家譜), password-gated (see src/lib/private-pages.ts). */
export const dynamic = "force-dynamic";

export function GET() {
  return servePrivatePage("lau-family");
}
