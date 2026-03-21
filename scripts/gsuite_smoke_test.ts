/**
 * Phase 5 Smoke Test — manual verification against real Google APIs.
 *
 * Prerequisites:
 *   1. Postgres running
 *   2. Google OAuth completed (start server, visit /auth/google, log in)
 *   3. Tokens stored in DB
 *
 * Run: npx tsx scripts/smoke_test.ts
 */

import * as fs from "node:fs";

// ── Load .env manually ───────────────────────────────────────────────────────
const envFile = new URL("../.env", import.meta.url).pathname;
try {
  const lines = fs.readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // rely on env already being set
}

import { loadTokens } from "../src/server/google/auth.js";
import { getMessage, getThread, listLabels, searchThreads } from "../src/server/google/gmail.js";
import { checkFreeBusy, listEvents } from "../src/server/google/calendar.js";
import { listRecentFiles, searchFiles } from "../src/server/google/drive.js";

function section(name: string) {
  console.error(`\n${"─".repeat(50)}`);
  console.error(`  ${name}`);
  console.error("─".repeat(50));
}

function pass(msg: string) {
  console.error(`  ✓ ${msg}`);
}

function fail(msg: string, err: unknown) {
  console.error(`  ✗ ${msg}`);
  console.error(`    ${err}`);
}

async function main() {
  console.error("Phase 5 Smoke Test");

  // Load tokens from DB
  section("Auth");
  try {
    await loadTokens();
    pass("Tokens loaded from DB");
  } catch (err) {
    fail("Failed to load tokens — did you complete OAuth?", err);
    process.exit(1);
  }

  // ── Gmail ──────────────────────────────────────────────────────────────────
  section("Gmail");

  let firstThreadId: string | undefined;

  try {
    const threads = await searchThreads("is:inbox", 5);
    pass(`searchThreads: ${threads.length} inbox thread(s) returned`);
    firstThreadId = threads[0]?.id;
  } catch (err) {
    fail("searchThreads", err);
  }

  if (firstThreadId) {
    try {
      const thread = await getThread(firstThreadId);
      const first = thread.messages[0];
      pass(`getThread: ${thread.messages.length} message(s), first from "${first?.from}"`);
      pass(`  subject: "${first?.subject}"`);
      pass(`  bodyText length: ${first?.bodyText.length} chars`);
      pass(`  bodyHtml length: ${first?.bodyHtml.length} chars`);

      if (first) {
        try {
          const msg = await getMessage(first.id);
          pass(`getMessage: decoded id=${msg.id}, labelIds=[${msg.labelIds.join(", ")}]`);
        } catch (err) {
          fail("getMessage", err);
        }
      }
    } catch (err) {
      fail("getThread", err);
    }
  }

  try {
    const labels = await listLabels();
    pass(`listLabels: ${labels.length} label(s)`);
  } catch (err) {
    fail("listLabels", err);
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  section("Calendar");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();

  try {
    const events = await listEvents(todayStart, todayEnd);
    pass(`listEvents (today): ${events.length} event(s)`);
    for (const e of events) {
      pass(`  "${e.summary}" — ${e.isAllDay ? "all-day" : e.start}`);
    }
  } catch (err) {
    fail("listEvents", err);
  }

  try {
    const freebusy = await checkFreeBusy(todayStart, weekEnd);
    const busy = freebusy["primary"]?.busy ?? [];
    pass(`checkFreeBusy: ${busy.length} busy interval(s) this week`);
  } catch (err) {
    fail("checkFreeBusy", err);
  }

  // ── Drive ──────────────────────────────────────────────────────────────────
  section("Drive");

  try {
    const recent = await listRecentFiles(5);
    pass(`listRecentFiles: ${recent.length} file(s)`);
    for (const f of recent) {
      pass(`  "${f.name}" (${f.mimeType})`);
    }
  } catch (err) {
    fail("listRecentFiles", err);
  }

  try {
    const results = await searchFiles("a");
    pass(`searchFiles ("a"): ${results.length} result(s)`);
  } catch (err) {
    fail("searchFiles", err);
  }

  section("Done");
}

main().catch((err) => {
  console.error("Smoke test crashed", err);
  process.exit(1);
});
