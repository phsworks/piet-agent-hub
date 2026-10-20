import { appUrl } from "@/lib/google/auth";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

// TickTick's Open API (v1): only lists and tasks. Habits, tags and focus aren't exposed.
const AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const SCOPES = "tasks:read tasks:write";
const TOKEN_KEY = "ticktick";

type StoredTickTick = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms; TickTick tokens last about half a year. */
  expiresAt: number | null;
  connectedAt: string;
};

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

function redirectUri() {
  return `${appUrl()}/api/ticktick/callback`;
}

function credentials() {
  const id = process.env.TICKTICK_CLIENT_ID;
  const secret = process.env.TICKTICK_CLIENT_SECRET;
  if (!id || !secret) throw new Error("TICKTICK_CLIENT_ID / TICKTICK_CLIENT_SECRET are not set in .env.local");
  return { id, secret };
}

export function isTickTickConfigured() {
  return Boolean(process.env.TICKTICK_CLIENT_ID && process.env.TICKTICK_CLIENT_SECRET);
}

export function buildTickTickConsentUrl(state: string) {
  const params = new URLSearchParams({
    client_id: credentials().id,
    scope: SCOPES,
    state,
    redirect_uri: redirectUri(),
    response_type: "code",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function requestToken(body: Record<string, string>) {
  const { id, secret } = credentials();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ scope: SCOPES, redirect_uri: redirectUri(), ...body }),
  });
  if (!res.ok) throw new Error(`TickTick token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  const stored: StoredTickTick = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    connectedAt: new Date().toISOString(),
  };
  await setSetting(TOKEN_KEY, stored);
  return stored;
}

export async function completeTickTickConsent(code: string) {
  await requestToken({ grant_type: "authorization_code", code });
}

export class TickTickNotConnectedError extends Error {
  constructor(reason = "TickTick is not connected. Connect it in Settings first.") {
    super(reason);
  }
}

// Refresh a day early, so a token never expires halfway through a request.
const EXPIRY_MARGIN_MS = 86_400_000;

export async function getTickTickToken() {
  const stored = await getSetting<StoredTickTick>(TOKEN_KEY);
  if (!stored) throw new TickTickNotConnectedError();
  if (stored.expiresAt && stored.expiresAt - EXPIRY_MARGIN_MS < Date.now()) {
    if (!stored.refreshToken) {
      throw new TickTickNotConnectedError("The TickTick connection has expired. Reconnect it in Settings.");
    }
    const refreshed = await requestToken({ grant_type: "refresh_token", refresh_token: stored.refreshToken });
    return refreshed.accessToken;
  }
  return stored.accessToken;
}

export async function getTickTickStatus() {
  const stored = await getSetting<StoredTickTick>(TOKEN_KEY);
  return {
    configured: isTickTickConfigured(),
    connected: Boolean(stored),
    connectedAt: stored?.connectedAt ?? null,
    expiresAt: stored?.expiresAt ? new Date(stored.expiresAt).toISOString() : null,
  };
}

export async function disconnectTickTick() {
  await deleteSetting(TOKEN_KEY);
}
