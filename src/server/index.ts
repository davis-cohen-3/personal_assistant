import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

const server = serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.error(`Server listening on http://localhost:${info.port}`);
});

function shutdown() {
  console.error("Shutting down...");
  server.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
