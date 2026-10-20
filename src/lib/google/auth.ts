import { OAuth2Client } from "google-auth-library";
import { getSetting, setSetting, deleteSetting } from "@/lib/settings";

// drive.readonly: read all of Piet's Drive. drive.file: write only to files and
// folders the app created itself (/PietBrain). Calendar scopes are requested now
// so Phase 4 doesn't need a second consent.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const TOKEN_KEY = "google";

type StoredGoogle = { refreshToken: string; email: string | null; connectedAt: string };

export function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

function newClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env.local");
  }
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: `${appUrl()}/api/google/callback`,
  });
}

export function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function buildConsentUrl(state: string) {
  return newClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token, even on reconnect
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function completeConsent(code: string) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google didn't return a refresh token. Remove the app's access in your Google account and try again.");
  }
  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token });
    email = ticket.getPayload()?.email ?? null;
  }
  await setSetting<StoredGoogle>(TOKEN_KEY, {
    refreshToken: tokens.refresh_token,
    email,
    connectedAt: new Date().toISOString(),
  });
}

export async function getGoogleStatus() {
  const stored = await getSetting<StoredGoogle>(TOKEN_KEY);
  return {
    configured: isGoogleConfigured(),
    connected: Boolean(stored),
    email: stored?.email ?? null,
    connectedAt: stored?.connectedAt ?? null,
  };
}

/** Google rejected the stored refresh token (revoked, or expired after 7 days while the OAuth app is in testing). */
export function isExpiredGrant(err: unknown) {
  return /invalid_grant/.test(String((err as { message?: string })?.message ?? err));
}

/** Status plus a live check that the token still works (one token request). */
export async function checkGoogle() {
  const status = await getGoogleStatus();
  if (!status.connected) return { ...status, error: null };
  try {
    await (await getAuthedClient()).getAccessToken();
    return { ...status, error: null };
  } catch (err) {
    return {
      ...status,
      error: isExpiredGrant(err)
        ? "The connection expired. Click Reconnect."
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

export async function disconnectGoogle() {
  const stored = await getSetting<StoredGoogle>(TOKEN_KEY);
  if (stored) {
    await newClient().revokeToken(stored.refreshToken).catch(() => {});
  }
  await deleteSetting(TOKEN_KEY);
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google is not connected. Connect it in Settings first.");
  }
}

/** OAuth client with Piet's stored refresh token; access tokens refresh automatically. */
export async function getAuthedClient() {
  const stored = await getSetting<StoredGoogle>(TOKEN_KEY);
  if (!stored) throw new GoogleNotConnectedError();
  const client = newClient();
  client.setCredentials({ refresh_token: stored.refreshToken });
  client.on("tokens", (tokens) => {
    if (tokens.refresh_token && tokens.refresh_token !== stored.refreshToken) {
      setSetting<StoredGoogle>(TOKEN_KEY, { ...stored, refreshToken: tokens.refresh_token }).catch(
        (err) => console.error("Failed to persist rotated Google refresh token", err)
      );
    }
  });
  return client;
}
