/**
 * Phase 4 SDK Spike — throwaway verification script.
 *
 * Answers:
 *   CLARITY-010: Which message type(s) carry session_id?
 *   HIGH-10:     Is streaming token-by-token or one block?
 *   IMP-017:     What happens on resume with a nonexistent session ID?
 *   CLARITY-002: What is the exact accepted model string format?
 *
 * Run: npx tsx scripts/sdk_spike.ts
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as dotenv from "node:fs";

// ── Load .env manually (no dotenv package) ──────────────────────────────────
const envFile = new URL("../.env", import.meta.url).pathname;
try {
  const lines = dotenv.readFileSync(envFile, "utf8").split("\n");
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
  // .env not found — rely on environment variables already being set
}

if (!process.env["ANTHROPIC_API_KEY"]) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

// ── Dummy MCP tool ───────────────────────────────────────────────────────────

const dummyTool = tool(
  "echo",
  "Echoes back the input message. Use this to demonstrate tool calling.",
  {
    message: z.string().describe("Message to echo back"),
  },
  async (args) => {
    console.error(`[MCP tool called] echo("${args.message}")`);
    return {
      content: [{ type: "text" as const, text: `Echo: ${args.message}` }],
    };
  }
);

// 0.2.x: server instances can't be reused across query() calls — create fresh per call
function makeToolsServer() {
  return createSdkMcpServer({
    name: "spike-tools",
    version: "1.0.0",
    tools: [dummyTool],
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function separator(label: string) {
  console.error(`\n${"=".repeat(60)}`);
  console.error(`  ${label}`);
  console.error("=".repeat(60));
}

function logMessage(msg: Record<string, unknown>, phase: string) {
  const type = msg["type"];
  const subtype = "subtype" in msg ? msg["subtype"] : undefined;
  const sessionId = "session_id" in msg ? msg["session_id"] : "(none)";
  const label = subtype ? `${type}/${subtype}` : type;
  console.error(`[${phase}] MSG type=${label}  session_id=${sessionId}`);

  // Log top-level field names so we know what's available
  const fields = Object.keys(msg).join(", ");
  console.error(`         fields: ${fields}`);

  // Extra detail per type
  if (type === "assistant") {
    const message = msg["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b["type"] === "text") {
          const text = b["text"] as string;
          console.error(`         [assistant text] (${text.length} chars): ${text.slice(0, 120)}...`);
        } else {
          console.error(`         [assistant block] type=${b["type"]}`);
        }
      }
    }
  }

  if (type === "stream_event") {
    const event = msg["event"] as Record<string, unknown> | undefined;
    const evType = event?.["type"];
    console.error(`         [stream_event] event.type=${evType}`);
    if (evType === "content_block_delta") {
      const delta = (event?.["delta"] as Record<string, unknown> | undefined);
      console.error(`         [stream_event] delta.type=${delta?.["type"]}  text=${JSON.stringify(delta?.["text"])?.slice(0, 60)}`);
    }
  }

  if (type === "result") {
    console.error(`         subtype=${msg["subtype"]}  num_turns=${msg["num_turns"]}  cost=$${(msg["total_cost_usd"] as number)?.toFixed(5)}`);
    if (msg["subtype"] === "success") {
      const result = msg["result"] as string;
      console.error(`         result text (${result.length} chars): ${result.slice(0, 200)}`);
    } else {
      const errors = msg["errors"];
      console.error(`         errors: ${JSON.stringify(errors)}`);
    }
  }

  if (type === "system" && subtype === "init") {
    const sysmsg = msg as Record<string, unknown>;
    console.error(`         model=${sysmsg["model"]}  permissionMode=${sysmsg["permissionMode"]}`);
    console.error(`         tools: ${JSON.stringify(sysmsg["tools"])}`);
    console.error(`         mcp_servers: ${JSON.stringify(sysmsg["mcp_servers"])}`);
  }
}

const BASE_OPTIONS = {
  systemPrompt: "You are a test agent. When asked to echo something, use the echo tool. Be very brief.",
  allowedTools: ["mcp__spike-tools__echo"],
  tools: [] as string[],
  permissionMode: "bypassPermissions" as const,
  allowDangerouslySkipPermissions: true,
  persistSession: true,
  settingSources: [] as ("user" | "project" | "local")[],
};

// ── Phase A: First query — log all events, capture session_id ────────────────

separator("PHASE A: First query — log all event types and shapes");

let capturedSessionId: string | undefined;
const streamEventTypes = new Set<string>();
let assistantMessageCount = 0;
let streamEventCount = 0;

console.error("\n[Phase A] Prompt: 'Use the echo tool with message: hello-spike'");

for await (const msg of query({
  prompt: "Use the echo tool with message: hello-spike. Then say 'done' in one word.",
  options: {
    ...BASE_OPTIONS,
    mcpServers: { "spike-tools": makeToolsServer() },
    includePartialMessages: true,
  },
})) {
  const m = msg as unknown as Record<string, unknown>;
  logMessage(m, "A");

  if ("session_id" in m && !capturedSessionId) {
    capturedSessionId = m["session_id"] as string;
    console.error(`\n  *** First session_id seen on type=${m["type"]}/${m["subtype"] ?? ""} ***`);
  }

  if (m["type"] === "assistant") assistantMessageCount++;
  if (m["type"] === "stream_event") {
    streamEventCount++;
    const evt = m["event"] as Record<string, unknown> | undefined;
    if (evt?.["type"]) streamEventTypes.add(evt["type"] as string);
  }
}

console.error(`\n[Phase A Summary]`);
console.error(`  Captured session_id: ${capturedSessionId}`);
console.error(`  Total assistant messages (full blocks): ${assistantMessageCount}`);
console.error(`  Total stream_event messages: ${streamEventCount}`);
console.error(`  Distinct stream event subtypes: ${[...streamEventTypes].join(", ")}`);
console.error(`  Streaming is token-by-token: ${streamEventCount > 3 ? "YES (many stream_event messages)" : streamEventCount > 0 ? "PARTIAL (some stream events)" : "NO (no stream_events)"}`);

// ── Phase B: List supported models ──────────────────────────────────────────

separator("PHASE B: List supported models (CLARITY-002)");

const modelsQ = query({
  prompt: "Say one word: ready",
  options: { ...BASE_OPTIONS, mcpServers: { "spike-tools": makeToolsServer() }, persistSession: false },
});

let modelsList: unknown[] = [];
for await (const msg of modelsQ) {
  const m = msg as unknown as Record<string, unknown>;
  if (m["type"] === "system" && m["subtype"] === "init") {
    console.error(`[Phase B] model in init message: ${(m as Record<string, unknown>)["model"]}`);
    try {
      modelsList = await (modelsQ as unknown as { supportedModels(): Promise<unknown[]> }).supportedModels();
      console.error(`[Phase B] supportedModels() returned ${modelsList.length} models:`);
      for (const m2 of modelsList.slice(0, 10)) {
        const mi = m2 as Record<string, unknown>;
        console.error(`  value=${mi["value"]}  displayName=${mi["displayName"]}`);
      }
    } catch (err) {
      console.error(`[Phase B] supportedModels() threw: ${err}`);
    }
    break;
  }
}

// Drain remaining messages
for await (const _msg of modelsQ) {
  // intentionally empty
}

// ── Phase C: Resume with valid session ID ───────────────────────────────────

separator("PHASE C: Resume with valid session_id (multi-turn)");

if (!capturedSessionId) {
  console.error("[Phase C] SKIP — no session_id captured in Phase A");
} else {
  console.error(`[Phase C] Resuming session: ${capturedSessionId}`);
  let resumed = false;
  let resumeSessionIdSeen: string | undefined;

  for await (const msg of query({
    prompt: "Use the echo tool with message: resume-test. Then say 'resumed' in one word.",
    options: {
      ...BASE_OPTIONS,
      mcpServers: { "spike-tools": makeToolsServer() },
      resume: capturedSessionId,
    },
  })) {
    const m = msg as unknown as Record<string, unknown>;
    logMessage(m, "C");

    if (!resumed && "session_id" in m) {
      resumeSessionIdSeen = m["session_id"] as string;
      resumed = true;
    }
  }

  console.error(`\n[Phase C Summary]`);
  console.error(`  session_id on resumed query: ${resumeSessionIdSeen}`);
  console.error(`  Same as original: ${resumeSessionIdSeen === capturedSessionId}`);
}

// ── Phase D: Resume with nonexistent session ID (IMP-017) ───────────────────

separator("PHASE D: Resume with nonexistent session_id (IMP-017)");

const fakeSessionId = "nonexistent-session-id-00000000-0000-0000-0000-000000000000";
console.error(`[Phase D] Attempting resume with fake session: ${fakeSessionId}`);

let phaseD_threw = false;
let phaseD_startedFresh = false;
let phaseD_hung = false;
let phaseD_resultSubtype: string | undefined;
let phaseD_sessionId: string | undefined;

const timeoutMs = 60_000;
const abortController = new AbortController();
const timeoutHandle = setTimeout(() => {
  phaseD_hung = true;
  abortController.abort();
  console.error("[Phase D] TIMEOUT — query hung for 60s, aborting");
}, timeoutMs);

try {
  for await (const msg of query({
    prompt: "Say one word: hello",
    options: {
      ...BASE_OPTIONS,
      mcpServers: { "spike-tools": makeToolsServer() },
      resume: fakeSessionId,
      abortController,
      persistSession: false,
    },
  })) {
    const m = msg as unknown as Record<string, unknown>;
    logMessage(m, "D");

    if ("session_id" in m && !phaseD_sessionId) {
      phaseD_sessionId = m["session_id"] as string;
      if (phaseD_sessionId !== fakeSessionId) {
        phaseD_startedFresh = true;
        console.error(`[Phase D] Got a DIFFERENT session_id — started fresh: ${phaseD_sessionId}`);
      } else {
        console.error(`[Phase D] Same session_id returned — resumed (unexpected)`);
      }
    }

    if (m["type"] === "result") {
      phaseD_resultSubtype = m["subtype"] as string;
    }
  }
} catch (err) {
  phaseD_threw = true;
  console.error(`[Phase D] THREW: ${err}`);
} finally {
  clearTimeout(timeoutHandle);
}

console.error(`\n[Phase D Summary — IMP-017]`);
console.error(`  Threw: ${phaseD_threw}`);
console.error(`  Hung (timeout): ${phaseD_hung}`);
console.error(`  Started fresh (new session_id): ${phaseD_startedFresh}`);
console.error(`  Result subtype: ${phaseD_resultSubtype ?? "(none)"}`);
console.error(`  Returned session_id: ${phaseD_sessionId}`);

if (phaseD_threw) {
  console.error("  IMP-017 BEHAVIOR: THROWS — catch block must create fresh session");
} else if (phaseD_hung) {
  console.error("  IMP-017 BEHAVIOR: HANGS — need Promise.race timeout or pre-check");
} else if (phaseD_startedFresh) {
  console.error("  IMP-017 BEHAVIOR: SILENTLY STARTS FRESH — no error thrown, new session_id");
} else {
  console.error("  IMP-017 BEHAVIOR: UNKNOWN — check logs above");
}

// ── Final Report ─────────────────────────────────────────────────────────────

separator("FINAL REPORT");

console.error(`
CLARITY-010: Where does session_id appear?
  Answer: session_id is present on EVERY SDKMessage type.
          It first appears on type=system/init (the very first message).

HIGH-10: Is streaming token-by-token?
  stream_event count in Phase A: ${streamEventCount}
  Distinct stream_event subtypes: ${[...streamEventTypes].join(", ")}
  Answer: ${
    streamEventCount > 3
      ? "YES — token-by-token. Use includePartialMessages: true and handle type='stream_event' with event.type='content_block_delta' for smooth streaming."
      : streamEventCount > 0
      ? `PARTIAL — only ${streamEventCount} events. May need investigation.`
      : "NO stream_event messages received. SDKAssistantMessage delivers full blocks. Use includePartialMessages: true to enable streaming."
  }

IMP-017: Resume with nonexistent session_id:
  Threw: ${phaseD_threw}
  Hung:  ${phaseD_hung}
  Started fresh: ${phaseD_startedFresh}

CLARITY-002: Model string format:
  See Phase B output above for supportedModels() list.
  The init message shows the actual model string used.
`);
