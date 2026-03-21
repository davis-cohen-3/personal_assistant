import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET = "test-jwt-secret-that-is-long-enough-for-signing!!";
  process.env.CSRF_SECRET = "test-csrf-secret-that-is-long-enough-for-signing!";
  process.env.ALLOWED_USERS = "allowed@example.com,other@example.com";
});

vi.mock("../../src/server/google/auth.js", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/auth"),
    getToken: vi.fn().mockResolvedValue({ tokens: { access_token: "tok" } }),
    setCredentials: vi.fn(),
  }),
  persistTokens: vi.fn().mockResolvedValue(undefined),
  loadTokens: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("googleapis", () => ({
  google: {
    oauth2: vi.fn().mockReturnValue({
      userinfo: {
        get: vi.fn().mockResolvedValue({ data: { email: "allowed@example.com" } }),
      },
    }),
  },
}));

import crypto from "node:crypto";
import { sign } from "hono/jwt";
import { authMiddleware, googleAuthRoutes } from "../../src/server/auth.js";
import { Hono } from "hono";

const JWT_SECRET = process.env.JWT_SECRET!;
const CSRF_SECRET = process.env.CSRF_SECRET!;

async function makeSessionCookie(): Promise<string> {
  const token = await sign(
    { email: "allowed@example.com", exp: Math.floor(Date.now() / 1000) + 3600 },
    JWT_SECRET,
    "HS256",
  );
  return `session=${token}`;
}

function expectedCsrfToken(sessionValue: string): string {
  return crypto.createHmac("sha256", CSRF_SECRET).update(sessionValue).digest("hex");
}

async function getSessionValue(cookie: string): Promise<string> {
  return cookie.replace("session=", "");
}

// Minimal app with authMiddleware applied + a protected POST route
function makeApp() {
  const app = new Hono();
  app.use("/*", authMiddleware);
  app.get("/protected", (c) => c.json({ ok: true }));
  app.post("/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("authMiddleware", () => {
  it("returns 401 with no session cookie", async () => {
    const app = makeApp();

    const res = await app.request("/protected", { method: "GET" });

    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid session cookie", async () => {
    const app = makeApp();

    const res = await app.request("/protected", {
      method: "GET",
      headers: { Cookie: "session=not-a-valid-jwt" },
    });

    expect(res.status).toBe(401);
  });

  it("allows GET with valid session (no CSRF check)", async () => {
    const app = makeApp();
    const cookie = await makeSessionCookie();

    const res = await app.request("/protected", {
      method: "GET",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(200);
  });

  it("returns 403 on POST without X-CSRF-Token", async () => {
    const app = makeApp();
    const cookie = await makeSessionCookie();

    const res = await app.request("/protected", {
      method: "POST",
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(403);
  });

  it("returns 403 on POST with wrong X-CSRF-Token", async () => {
    const app = makeApp();
    const cookie = await makeSessionCookie();

    const res = await app.request("/protected", {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": "wrong-token" },
    });

    expect(res.status).toBe(403);
  });

  it("allows POST with correct X-CSRF-Token", async () => {
    const app = makeApp();
    const cookie = await makeSessionCookie();
    const sessionValue = await getSessionValue(cookie);
    const csrfToken = expectedCsrfToken(sessionValue);

    const res = await app.request("/protected", {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    });

    expect(res.status).toBe(200);
  });
});

describe("GET /auth/google/callback", () => {
  it("returns 403 when email is not in ALLOWED_USERS", async () => {
    const { google } = await import("googleapis");
    vi.mocked(google.oauth2).mockReturnValue({
      userinfo: {
        get: vi.fn().mockResolvedValue({ data: { email: "stranger@example.com" } }),
      },
    } as never);

    const app = new Hono();
    app.route("/auth", googleAuthRoutes);

    const res = await app.request("/auth/google/callback?code=authcode");

    expect(res.status).toBe(403);
  });

  it("redirects to /?auth_error=oauth_failed on OAuth error from Google", async () => {
    const app = new Hono();
    app.route("/auth", googleAuthRoutes);

    const res = await app.request("/auth/google/callback?error=access_denied");

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toBe("/?auth_error=oauth_failed");
  });
});

describe("GET /auth/status", () => {
  it("returns authenticated: false with no session", async () => {
    const app = new Hono();
    app.route("/auth", googleAuthRoutes);

    const res = await app.request("/auth/status");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(false);
  });

  it("returns authenticated: true and csrfToken with valid session", async () => {
    const app = new Hono();
    app.route("/auth", googleAuthRoutes);
    const cookie = await makeSessionCookie();

    const res = await app.request("/auth/status", {
      headers: { Cookie: cookie },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken).toHaveLength(64); // 32 bytes hex
  });
});

describe("GET /auth/logout", () => {
  it("clears the session cookie", async () => {
    const app = new Hono();
    app.route("/auth", googleAuthRoutes);
    const cookie = await makeSessionCookie();

    const res = await app.request("/auth/logout", {
      headers: { Cookie: cookie },
    });

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
