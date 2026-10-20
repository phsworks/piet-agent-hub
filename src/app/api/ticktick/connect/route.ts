import crypto from "node:crypto";
import { cookies } from "next/headers";
import { buildTickTickConsentUrl } from "@/lib/ticktick/auth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "ticktick_oauth_state";

export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return Response.redirect(buildTickTickConsentUrl(state));
}
