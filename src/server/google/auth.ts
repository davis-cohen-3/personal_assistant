import { type Auth, google } from "googleapis";

type OAuth2Client = InstanceType<typeof Auth.OAuth2Client>;
type Credentials = Auth.Credentials;

import { decrypt, encrypt } from "../crypto.js";
import { getGoogleTokens, upsertGoogleTokens } from "../db/queries.js"; // lint-ignore: credential persistence is part of Google API auth infrastructure, not a connector concern
import { AppError } from "../exceptions.js";

let oauthClient: OAuth2Client | null = null;

export function getAuthClient(): OAuth2Client {
  if (!oauthClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId) throw new AppError("Missing GOOGLE_CLIENT_ID", 500);
    if (!clientSecret) throw new AppError("Missing GOOGLE_CLIENT_SECRET", 500);
    if (!redirectUri) throw new AppError("Missing GOOGLE_REDIRECT_URI", 500);

    oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Re-persist tokens automatically on every refresh
    oauthClient.on("tokens", (tokens) => {
      console.info("google.auth token refresh received", { expiryDate: tokens.expiry_date });
      persistTokens(tokens).catch((err) => {
        console.error("Failed to persist refreshed tokens", { error: err });
      });
    });
  }
  return oauthClient;
}

export async function persistTokens(tokens: Credentials): Promise<void> {
  if (!tokens.access_token) throw new AppError("Missing access_token", 500);

  // On a refresh event, refresh_token is not returned — load the existing one
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const existing = await getGoogleTokens();
    if (!existing) throw new AppError("No existing tokens to refresh against", 500);
    refreshToken = decrypt(existing.refresh_token);
  }

  if (!tokens.expiry_date) throw new AppError("Missing expiry_date", 500);

  await upsertGoogleTokens({
    access_token: encrypt(tokens.access_token),
    refresh_token: encrypt(refreshToken),
    scope: tokens.scope ?? "",
    token_type: tokens.token_type ?? "Bearer",
    // FEAS-011: explicit epoch ms → Date conversion
    expiry_date: new Date(tokens.expiry_date),
  });
}

export async function isGoogleConnected(): Promise<boolean> {
  const stored = await getGoogleTokens();
  return stored !== null;
}

export async function loadTokens(): Promise<void> {
  const stored = await getGoogleTokens();
  if (!stored) {
    console.info("google.auth.loadTokens — no stored tokens (pre-login)");
    return;
  }
  console.info("google.auth.loadTokens — credentials loaded", { expiryDate: stored.expiry_date });
  getAuthClient().setCredentials({
    access_token: decrypt(stored.access_token),
    refresh_token: decrypt(stored.refresh_token),
    scope: stored.scope,
    token_type: stored.token_type,
    expiry_date: stored.expiry_date.getTime(), // googleapis expects epoch ms
  });
}
