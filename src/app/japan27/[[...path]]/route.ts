import { redirect } from "next/navigation";

/** Old address of the Japan Dec 2026 page; it now lives at /experiments/japan27. */
export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const parts = (await params).path ?? [];
  redirect("/experiments/japan27" + (parts.length ? "/" + parts.map(encodeURIComponent).join("/") : ""));
}
