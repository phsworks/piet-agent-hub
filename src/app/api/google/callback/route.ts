import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { appUrl, completeConsent } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const back = (status: string) =>
    Response.redirect(`${appUrl()}/settings?google=${encodeURIComponent(status)}`);

  if (params.get("error")) return back(params.get("error")!);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return back("invalid_state");

  try {
    await completeConsent(code);
    return back("connected");
  } catch (err) {
    console.error("Google connect failed", err);
    return back(err instanceof Error ? err.message : "failed");
  }
}
