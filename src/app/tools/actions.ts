"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TOOLS_COOKIE } from "@/lib/tools-auth";

/** Signs this browser out of the tools (see src/lib/tools-auth.ts). */
export async function logout() {
  (await cookies()).delete({ name: TOOLS_COOKIE, path: "/tools" });
  redirect("/tools");
}
