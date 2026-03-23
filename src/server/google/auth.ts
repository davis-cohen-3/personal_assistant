import { type Auth, google } from "googleapis";

export type OAuth2Client = InstanceType<typeof Auth.OAuth2Client>;
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
  }
  return oauthClient;
}

export async function persistTokens(userId: string, tokens: Credentials): Promise<void> {
  if (!tokens.access_token) throw new AppError("Missing access_token", 500);

  // On a refresh event, refresh_token is not returned — load the existing one
  let refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    const existing = await getGoogleTokens(userId);
    if (!existing) throw new AppError("No existing tokens to refresh against", 500);
    refreshToken = decrypt(existing.refresh_token);
  }

  if (!tokens.expiry_date) throw new AppError("Missing expiry_date", 500);

  if (!tokens.scope) throw new AppError("Missing scope in OAuth tokens", 500);
  if (!tokens.token_type) throw new AppError("Missing token_type in OAuth tokens", 500);

  await upsertGoogleTokens(userId, {
    access_token: encrypt(tokens.access_token),
    refresh_token: encrypt(refreshToken),
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: new Date(tokens.expiry_date),
  });
}

export async function isGoogleConnected(userId: string): Promise<boolean> {
  const stored = await getGoogleTokens(userId);
  return stored !== null;
}

export async function withUserTokens(userId: string): Promise<OAuth2Client> {
  const stored = await getGoogleTokens(userId);
  if (!stored) throw new AppError("No Google tokens for user", 401);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId) throw new AppError("Missing GOOGLE_CLIENT_ID", 500);
  if (!clientSecret) throw new AppError("Missing GOOGLE_CLIENT_SECRET", 500);
  if (!redirectUri) throw new AppError("Missing GOOGLE_REDIRECT_URI", 500);

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({
    access_token: decrypt(stored.access_token),
    refresh_token: decrypt(stored.refresh_token),
    scope: stored.scope,
    token_type: stored.token_type,
    expiry_date: stored.expiry_date.getTime(),
  });

  let pendingTokenPersist: Promise<void> | null = null;
  let tokenPersistError: unknown = null;

  client.on("tokens", (tokens) => {
    console.info("google.auth token refresh received", {
      userId,
      expiryDate: tokens.expiry_date,
    });
    tokenPersistError = null;
    pendingTokenPersist = persistTokens(userId, tokens).catch((err) => {
      tokenPersistError = err;
    });
  });

  const originalRequest = client.request.bind(client);
  client.request = async <T>(opts: Parameters<typeof originalRequest<T>>[0]) => {
    const result = await originalRequest<T>(opts);
    if (pendingTokenPersist) {
      await pendingTokenPersist;
      pendingTokenPersist = null;
      if (tokenPersistError) {
        throw new AppError("Failed to persist refreshed Google tokens", 500, {
          cause: tokenPersistError as Error,
        });
      }
    }
    return result;
  };

  return client;
}
