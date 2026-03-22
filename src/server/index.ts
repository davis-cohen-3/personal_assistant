import { execSync } from "node:child_process";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { handleWebSocket } from "./agent.js";
import { authMiddleware, googleAuthRoutes } from "./auth.js";
import type { AppEnv } from "./env.js";
import { AppError } from "./exceptions.js";
import { apiRoutes } from "./routes.js";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CSRF_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "ANTHROPIC_API_KEY",
  "ENCRYPTION_KEY",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const app = new Hono<AppEnv>();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

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

// CSP headers for all responses
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:",
  );
});

// Serve static assets (no auth required)
app.use("/assets/*", serveStatic({ root: "./dist/client" }));

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Public auth routes
app.route("/auth", googleAuthRoutes);

// Origin validation for WebSocket (CLARITY-014)
const originGuard: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("Origin");
  const host = c.req.header("Host");
  if (!origin || !host) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const originHostname = new URL(origin).hostname;
  const serverHostname = host.split(":")[0];
  if (originHostname !== serverHostname) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
};

// WebSocket route: origin check → auth → upgrade
app.use("/ws", originGuard);
app.use("/ws", authMiddleware);
app.get("/ws", upgradeWebSocket(handleWebSocket));

// Protected API routes
app.use("/api/*", authMiddleware);
app.route("/api", apiRoutes);

// SPA catch-all — must be last
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

const server = serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.info(`Server listening on http://localhost:${info.port}`);
}) as Server;

injectWebSocket(server);

function shutdown() {
  console.info("Shutting down...");
  server.closeAllConnections();
  server.close();
  process.exit(0);
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.warn("Port 3000 in use — killing existing process");
    try {
      execSync("lsof -ti:3000 | xargs kill -9 2>/dev/null", { stdio: "ignore" });
    } catch {
      // No process found or already dead
    }
    setTimeout(() => server.listen(3000), 500);
  } else {
    console.error("Server error", { error: err });
    process.exit(1);
  }
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
