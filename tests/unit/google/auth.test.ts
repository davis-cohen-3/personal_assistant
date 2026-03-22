import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Set env vars before module loads
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/auth/google/callback";
  process.env.ENCRYPTION_KEY = "b".repeat(64);
});

vi.mock("../../../src/server/crypto.js", () => ({
  encrypt: vi.fn((s: string) => `encrypted:${s}`),
  decrypt: vi.fn((s: string) => s.replace("encrypted:", "")),
}));

vi.mock("../../../src/server/db/queries.js", () => ({
  getGoogleTokens: vi.fn(),
  upsertGoogleTokens: vi.fn(),
}));

import * as cryptoModule from "../../../src/server/crypto.js";
import * as queries from "../../../src/server/db/queries.js";
import { isGoogleConnected, persistTokens, withUserTokens } from "../../../src/server/google/auth.js";

const mockEncrypt = vi.mocked(cryptoModule.encrypt);
const mockDecrypt = vi.mocked(cryptoModule.decrypt);
const mockUpsert = vi.mocked(queries.upsertGoogleTokens);
const mockGet = vi.mocked(queries.getGoogleTokens);

const TEST_USER_ID = "user-1";

beforeAll(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistTokens", () => {
  it("encrypts both access_token and refresh_token before upserting", async () => {
    mockUpsert.mockResolvedValue({} as never);

    await persistTokens(TEST_USER_ID, {
      access_token: "my-access-token",
      refresh_token: "my-refresh-token",
      scope: "email",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
    });

    expect(mockEncrypt).toHaveBeenCalledWith("my-access-token");
    expect(mockEncrypt).toHaveBeenCalledWith("my-refresh-token");
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe("persistTokens — refresh path (no refresh_token)", () => {
  it("loads existing refresh_token from DB when not provided in tokens", async () => {
    mockUpsert.mockResolvedValue({} as never);
    mockGet.mockResolvedValue({
      user_id: TEST_USER_ID,
      access_token: "encrypted:old-access",
      refresh_token: "encrypted:existing-refresh",
      scope: "email",
      token_type: "Bearer",
      expiry_date: new Date(Date.now() + 3600000),
      updated_at: new Date(),
    });

    await persistTokens(TEST_USER_ID, {
      access_token: "new-access-token",
      scope: "email",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
    });

    expect(mockGet).toHaveBeenCalledOnce();
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted:existing-refresh");
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe("withUserTokens", () => {
  it("loads tokens and sets credentials on the auth client", async () => {
    mockGet.mockResolvedValue({
      user_id: TEST_USER_ID,
      access_token: "encrypted:stored-access",
      refresh_token: "encrypted:stored-refresh",
      scope: "email",
      token_type: "Bearer",
      expiry_date: new Date(Date.now() + 3600000),
      updated_at: new Date(),
    });

    const client = await withUserTokens(TEST_USER_ID);

    expect(client).toBeDefined();
    expect(mockGet).toHaveBeenCalledWith(TEST_USER_ID);
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted:stored-access");
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted:stored-refresh");
  });

  it("throws when no tokens exist for user", async () => {
    mockGet.mockResolvedValue(null);

    await expect(withUserTokens(TEST_USER_ID)).rejects.toThrow("No Google tokens for user");
  });
});

describe("isGoogleConnected", () => {
  it("returns true when tokens exist", async () => {
    mockGet.mockResolvedValue({
      user_id: TEST_USER_ID,
      access_token: "enc",
      refresh_token: "enc",
      scope: "email",
      token_type: "Bearer",
      expiry_date: new Date(),
      updated_at: new Date(),
    });

    const result = await isGoogleConnected(TEST_USER_ID);
    expect(result).toBe(true);
  });

  it("returns false when no tokens exist", async () => {
    mockGet.mockResolvedValue(null);

    const result = await isGoogleConnected(TEST_USER_ID);
    expect(result).toBe(false);
  });
});
