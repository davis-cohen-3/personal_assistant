import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Context } from "hono";
import type { WSContext, WSEvents } from "hono/ws";
import { z } from "zod";
import {
  createChatMessage,
  getConversation,
  listMessagesByConversation,
  updateConversation,
} from "./db/queries.js";
import { createCustomMcpServer } from "./tools.js";

const BASE_SYSTEM_PROMPT = `You are a personal assistant that helps manage email, calendar, and drive.

## Tools
You have access to email tools (sync_email for reading, action_email for sending/replying/drafting),
Google tools (calendar, drive), and data tools (buckets for managing and assigning).

## How You Work
You use tools to read and write data. The frontend automatically reflects changes
you make — you do not need to render UI components. Just describe what you did or
what you found in plain text.

## Subagents
You can spawn subagents for parallel work. Use them when:
- Classifying a large number of threads (>25) — spawn email-classifier
- Prepping multiple meetings — spawn meeting-prepper
- Broad cross-service research — spawn researcher
Subagents handle read-only work and return summaries. Only YOU execute write
operations (sending email, creating events) after user approval.
Don't spawn subagents for small tasks you can handle inline.

## Approval Pattern
NEVER execute side-effect operations directly. Always:
1. Describe what you plan to do in your response text
2. Wait for the user to confirm in chat (e.g., "go ahead", "yes", "send it")
3. Only then execute the operation

## Compaction
When compacting conversation history, always preserve:
- The user's current task or request
- Any pending actions awaiting approval
- Names and context of participants discussed in recent messages
- Active bucket assignments mentioned recently`;

export let SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  "email-classifier": {
    description:
      "Classifies email threads into buckets. Use for inbox triage and bulk classification.",
    prompt:
      "You are an email classification assistant. Sync the inbox, read bucket definitions, then classify all unbucketed threads in batches of 25...",
    tools: ["mcp__assistant-tools__sync_email", "mcp__assistant-tools__buckets"],
    model: "haiku",
  },
  "meeting-prepper": {
    description: "Researches context for upcoming meetings. Use when prepping multiple meetings.",
    prompt: "You are a meeting prep assistant. Research context for each meeting...",
    tools: [
      "mcp__assistant-tools__calendar",
      "mcp__assistant-tools__sync_email",
      "mcp__assistant-tools__drive",
    ],
    model: "haiku",
  },
  researcher: {
    description: "General-purpose cross-service search. Use for broad research queries.",
    prompt: "You are a research assistant. Search across email, calendar, and drive...",
    tools: [
      "mcp__assistant-tools__sync_email",
      "mcp__assistant-tools__calendar",
      "mcp__assistant-tools__drive",
    ],
    model: "haiku",
  },
};

const BASE_OPTIONS = {
  model: "claude-sonnet-4-6",
  permissionMode: "bypassPermissions" as const,
  allowDangerouslySkipPermissions: true,
  allowedTools: [
    "mcp__assistant-tools__sync_email",
    "mcp__assistant-tools__action_email",
    "mcp__assistant-tools__calendar",
    "mcp__assistant-tools__drive",
    "mcp__assistant-tools__buckets",
    "Agent",
  ],
  tools: [] as string[],
  agents: AGENT_DEFINITIONS,
  persistSession: true,
  settingSources: [] as ("user" | "project" | "local")[],
  includePartialMessages: true,
};

async function loadSkillsAddition(skillsDir: string): Promise<string> {
  let addition = "";
  let entries: Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const content = await readFile(join(skillsDir, entry.name), "utf8");
      addition += `\n\n${content}`;
    } else if (entry.isDirectory()) {
      const subPath = join(skillsDir, entry.name);
      const subEntries = await readdir(subPath, { withFileTypes: true });
      for (const subEntry of subEntries) {
        if (subEntry.isFile() && subEntry.name.endsWith(".md")) {
          const content = await readFile(join(subPath, subEntry.name), "utf8");
          addition += `\n\n${content}`;
        }
      }
    }
  }

  return addition;
}

export async function initAgent(): Promise<void> {
  const skillsDir = join(process.cwd(), ".claude", "skills");
  const addition = await loadSkillsAddition(skillsDir);
  SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + addition;
}

const IncomingMessage = z.object({
  type: z.literal("chat"),
  content: z.string().min(1),
});

export async function streamQuery(
  ws: WSContext,
  conversationId: string,
  prompt: string,
  sessionId?: string,
): Promise<void> {
  const mcpServer = createCustomMcpServer();
  let capturedSessionId: string | undefined;
  let fullText = "";

  const runQuery = async (withResume: boolean): Promise<void> => {
    capturedSessionId = undefined;
    fullText = "";

    const options = {
      ...BASE_OPTIONS,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { "assistant-tools": mcpServer },
      ...(withResume && sessionId !== undefined ? { resume: sessionId } : {}),
    };

    console.info("Agent query start", {
      conversationId,
      promptLength: prompt.length,
      withResume,
    });

    const gen = query({ prompt, options });
    for await (const msg of gen) {
      if (!capturedSessionId && msg.session_id) {
        capturedSessionId = msg.session_id;
      }

      if (
        msg.type === "stream_event" &&
        msg.event.type === "content_block_delta" &&
        msg.event.delta.type === "text_delta"
      ) {
        ws.send(JSON.stringify({ type: "text_delta", content: msg.event.delta.text }));
      }

      if (msg.type === "tool_progress") {
        console.info("Agent tool call", {
          conversationId,
          toolName: msg.tool_name,
          elapsedSeconds: msg.elapsed_time_seconds,
        });
      }

      if (msg.type === "result" && msg.subtype === "success") {
        fullText = msg.result;
        console.info("Agent query complete", {
          conversationId,
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          costUsd: msg.total_cost_usd,
          resultLength: fullText.length,
        });
      }

      if (msg.type === "result" && msg.subtype !== "success") {
        console.error("Agent query error", {
          conversationId,
          subtype: msg.subtype,
          numTurns: msg.num_turns,
          errors: msg.errors,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Agent encountered an error — check server logs",
          }),
        );
        return;
      }
    }
  };

  if (sessionId !== undefined) {
    try {
      await runQuery(true);
    } catch (err) {
      console.error("Stale session detected, retrying without resume", {
        error: err,
      });
      await runQuery(false);
    }
  } else {
    await runQuery(false);
  }

  if (capturedSessionId) {
    await updateConversation(conversationId, {
      sdk_session_id: capturedSessionId,
    });
  }
  if (fullText) {
    await createChatMessage(conversationId, "assistant", fullText);
  }
  ws.send(JSON.stringify({ type: "text_done", content: fullText }));
}

export function handleWebSocket(c: Context): WSEvents {
  const conversationId = new URL(c.req.url).searchParams.get("conversationId");

  return {
    onOpen: (_evt, ws) => {
      if (!conversationId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing conversationId" }));
        ws.close();
      }
    },

    onMessage: async (evt, ws) => {
      let msg: z.infer<typeof IncomingMessage>;
      try {
        msg = IncomingMessage.parse(JSON.parse(evt.data as string));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        return;
      }

      if (!conversationId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing conversationId" }));
        return;
      }

      console.info("WS message received", { conversationId, content: msg.content.slice(0, 80) });

      try {
        const conversation = await getConversation(conversationId);
        if (!conversation) {
          ws.send(JSON.stringify({ type: "error", message: "Conversation not found" }));
          return;
        }

        await createChatMessage(conversationId, "user", msg.content);

        const messages = await listMessagesByConversation(conversationId);
        const userMessages = messages.filter((m) => m.role === "user");
        if (userMessages.length === 1) {
          const title = msg.content.slice(0, 80);
          await updateConversation(conversationId, { title });
          ws.send(JSON.stringify({ type: "conversation_updated", conversationId, title }));
        }

        const sessionId =
          conversation.sdk_session_id !== null ? conversation.sdk_session_id : undefined;
        await streamQuery(ws, conversationId, msg.content, sessionId);
      } catch (err) {
        console.error("Agent error", { conversationId, error: err });
        ws.send(JSON.stringify({ type: "error", message: "Agent error — check server logs" }));
      }
    },

    onClose: (evt, _ws) => {
      console.info("WebSocket closed", {
        conversationId,
        code: (evt as CloseEvent).code,
        reason: (evt as CloseEvent).reason,
        wasClean: (evt as CloseEvent).wasClean,
      });
    },
  };
}
