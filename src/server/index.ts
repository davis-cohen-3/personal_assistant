import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { authMiddleware, googleAuthRoutes } from "./auth.js";
import { AppError } from "./exceptions.js";
import { loadTokens } from "./google/index.js";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CSRF_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "ALLOWED_USERS",
  "ANTHROPIC_API_KEY",
  "ENCRYPTION_KEY",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof ZodError) {
    console.error("Validation failed", { issues: err.issues });
    return c.json({ error: "Validation failed", issues: err.issues }, 400);
  }

  if (err instanceof AppError) {
    console.error(err.message, { status: err.status, cause: err.cause });
    const message = err.userFacing ? err.message : "Internal server error";
    return c.json({ error: message }, err.status as ContentfulStatusCode);
  }

  console.error("Unhandled error", { error: err });
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Public auth routes
app.route("/auth", googleAuthRoutes);

// Protected routes — require valid session
app.use("/api/*", authMiddleware);

const server = serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.error(`Server listening on http://localhost:${info.port}`);
});

// Load persisted Google tokens on startup
loadTokens().catch((err) => {
  console.error("Failed to load Google tokens at startup", { error: err });
});

function shutdown() {
  console.error("Shutting down...");
  server.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
