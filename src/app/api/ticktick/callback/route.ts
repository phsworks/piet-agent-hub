import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { appUrl } from "@/lib/google/auth";
import { completeTickTickConsent } from "@/lib/ticktick/auth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "ticktick_oauth_state";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const back = (status: string) =>
    Response.redirect(`${appUrl()}/settings?ticktick=${encodeURIComponent(status)}`);

  if (params.get("error")) return back(params.get("error")!);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return back("invalid_state");

  try {
    await completeTickTickConsent(code);
    return back("connected");
  } catch (err) {
    console.error("TickTick connect failed", err);
    return back(err instanceof Error ? err.message : "failed");
  }
}
