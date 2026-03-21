import { beforeAll, describe, expect, it, vi } from "vitest";

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
import { loadTokens, persistTokens } from "../../../src/server/google/auth.js";

const mockEncrypt = vi.mocked(cryptoModule.encrypt);
const mockDecrypt = vi.mocked(cryptoModule.decrypt);
const mockUpsert = vi.mocked(queries.upsertGoogleTokens);
const mockGet = vi.mocked(queries.getGoogleTokens);

beforeAll(() => {
  vi.clearAllMocks();
});

describe("persistTokens", () => {
  it("calls encrypt on access_token", async () => {
    mockUpsert.mockResolvedValue({} as never);

    await persistTokens({
      access_token: "my-access-token",
      refresh_token: "my-refresh-token",
      scope: "email",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
    });

    expect(mockEncrypt).toHaveBeenCalledWith("my-access-token");
  });

  it("calls encrypt on refresh_token", async () => {
    mockEncrypt.mockClear();
    mockUpsert.mockResolvedValue({} as never);

    await persistTokens({
      access_token: "my-access-token",
      refresh_token: "my-refresh-token",
      scope: "email",
      token_type: "Bearer",
      expiry_date: Date.now() + 3600000,
    });

    expect(mockEncrypt).toHaveBeenCalledWith("my-refresh-token");
  });
});

describe("loadTokens", () => {
  it("calls decrypt on stored access_token", async () => {
    mockGet.mockResolvedValue({
      id: "primary",
      access_token: "encrypted:stored-access",
      refresh_token: "encrypted:stored-refresh",
      scope: "email",
      token_type: "Bearer",
      expiry_date: new Date(Date.now() + 3600000),
      updated_at: new Date(),
    });

    await loadTokens();

    expect(mockDecrypt).toHaveBeenCalledWith("encrypted:stored-access");
  });

  it("calls decrypt on stored refresh_token", async () => {
    mockDecrypt.mockClear();
    mockGet.mockResolvedValue({
      id: "primary",
      access_token: "encrypted:stored-access",
      refresh_token: "encrypted:stored-refresh",
      scope: "email",
      token_type: "Bearer",
      expiry_date: new Date(Date.now() + 3600000),
      updated_at: new Date(),
    });

    await loadTokens();

    expect(mockDecrypt).toHaveBeenCalledWith("encrypted:stored-refresh");
  });
});
