import crypto from "node:crypto";
import { google } from "googleapis";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getAuthClient, persistTokens } from "./google/auth.js";

const rawAllowedUsers = process.env.ALLOWED_USERS;
if (!rawAllowedUsers) throw new Error("Missing required env var: ALLOWED_USERS");
const ALLOWED_USERS = rawAllowedUsers.split(",").map((e) => e.trim().toLowerCase());

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing required env var: JWT_SECRET");

const CSRF_SECRET = process.env.CSRF_SECRET;
if (!CSRF_SECRET) throw new Error("Missing required env var: CSRF_SECRET");

export const googleAuthRoutes = new Hono();

// Initiate Google OAuth — login + API scopes in one step
googleAuthRoutes.get("/google", (c) => {
  const oauth2Client = getAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return c.redirect(url);
});

// OAuth callback — verify allowlist, set session cookie, redirect to app
googleAuthRoutes.get("/google/callback", async (c) => {
  const error = c.req.query("error");
  if (error) {
    // SEC-002: do NOT reflect raw Google error in redirect
    console.error("OAuth callback received error from Google", { error });
    return c.redirect("/?auth_error=oauth_failed");
  }

  const code = c.req.query("code");
  if (!code) {
    return c.redirect("/?auth_error=oauth_failed");
  }

  try {
    const oauth2Client = getAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email?.toLowerCase();

    if (!email || !ALLOWED_USERS.includes(email)) {
      return c.json({ error: "Not authorized. Contact the admin." }, 403);
    }

    await persistTokens(tokens);

    const token = await sign(
      { email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 },
      JWT_SECRET,
      "HS256",
    );

    setCookie(c, "session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 60 * 60 * 24 * 30,
    });

    return c.redirect("/");
  } catch (err) {
    console.error("OAuth callback failed", { error: err });
    return c.redirect("/?auth_error=oauth_failed");
  }
});

// Logout
googleAuthRoutes.get("/logout", (c) => {
  setCookie(c, "session", "", { maxAge: 0 });
  return c.redirect("/");
});

// Session status — returns CSRF token when authenticated
googleAuthRoutes.get("/status", async (c) => {
  const session = getCookie(c, "session");
  if (!session) return c.json({ authenticated: false });
  try {
    await verify(session, JWT_SECRET, "HS256");
    // CSRF token: HMAC of the session JWT using CSRF_SECRET (HIGH-9)
    const csrfToken = crypto.createHmac("sha256", CSRF_SECRET).update(session).digest("hex");
    return c.json({ authenticated: true, csrfToken });
  } catch (err) {
    console.error("Session verification failed", { error: err });
    return c.json({ authenticated: false });
  }
});

// Auth middleware — cookie-only, enforces CSRF on state-changing methods
export const authMiddleware = createMiddleware(async (c, next) => {
  const session = getCookie(c, "session");
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  try {
    const payload = await verify(session, JWT_SECRET, "HS256");
    c.set("userEmail", payload.email);
  } catch (err) {
    console.error("Auth middleware: session verification failed", { error: err });
    return c.json({ error: "Invalid session" }, 401);
  }

  // CSRF check on state-changing methods — uses CSRF_SECRET (HIGH-9)
  const method = c.req.method;
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    const csrfHeader = c.req.header("X-CSRF-Token");
    const expected = crypto.createHmac("sha256", CSRF_SECRET).update(session).digest("hex");
    if (csrfHeader !== expected) {
      return c.json({ error: "Invalid CSRF token" }, 403);
    }
  }

  await next();
});
