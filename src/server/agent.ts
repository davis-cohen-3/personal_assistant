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

const SYSTEM_PROMPT = `You are a personal assistant that helps manage email, calendar, and drive.

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

const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  "email-classifier": {
    description:
      "Classifies email threads into buckets. Use for inbox triage and bulk classification.",
    prompt:
      "You are an email classification assistant. Sync the inbox, read bucket definitions, then classify ALL unbucketed threads in batches of 25. After each batch, check how many remain and keep going until zero unbucketed threads remain. Do not stop early.",
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
  maxTurns: 30,
  maxBudgetUsd: 5.0,
};

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  "mcp__assistant-tools__sync_email": "Reading emails",
  "mcp__assistant-tools__action_email": "Managing email",
  "mcp__assistant-tools__calendar": "Checking calendar",
  "mcp__assistant-tools__drive": "Searching drive",
  "mcp__assistant-tools__buckets": "Managing buckets",
  Agent: "Delegating to assistant",
};

function toolDisplayName(rawName: string): string {
  return TOOL_DISPLAY_NAMES[rawName] ?? rawName;
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
  abortController?: AbortController,
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
      ...(abortController ? { abortController } : {}),
      ...(withResume && sessionId !== undefined ? { resume: sessionId } : {}),
    };

    console.info("Agent query start", {
      conversationId,
      promptLength: prompt.length,
      withResume,
    });

    const gen = query({ prompt, options });
    let hasToolUse = false;
    for await (const msg of gen) {
      if (!capturedSessionId && msg.session_id) {
        capturedSessionId = msg.session_id;
      }

      // Detect tool_use blocks and forward tool name to client
      if (msg.type === "stream_event" && msg.event.type === "content_block_start") {
        const evt = msg.event as Record<string, unknown>;
        const raw = evt.content_block;
        const block =
          typeof raw === "object" && raw !== null && "type" in raw
            ? (raw as { type: string; name?: string })
            : undefined;
        if (block?.type === "tool_use" && block.name) {
          hasToolUse = true;
          const displayName = toolDisplayName(block.name);
          console.info("Agent tool use", { conversationId, toolName: block.name, displayName });
          ws.send(JSON.stringify({ type: "tool_status", toolName: block.name, displayName }));
        }
      }

      // Only forward text_delta if no tools have been called (simple response).
      // For multi-turn tool queries, text_done sends the authoritative final text.
      if (
        msg.type === "stream_event" &&
        msg.event.type === "content_block_delta" &&
        msg.event.delta.type === "text_delta" &&
        !hasToolUse
      ) {
        ws.send(JSON.stringify({ type: "text_delta", content: msg.event.delta.text }));
      }

      if (msg.type === "tool_progress") {
        console.info("Agent tool progress", {
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
          costUsd: msg.total_cost_usd,
          errors: msg.errors,
        });
        let userMessage: string;
        switch (msg.subtype) {
          case "error_max_turns":
            userMessage = "Agent reached its turn limit. Try a more specific request.";
            break;
          case "error_max_budget_usd":
            userMessage = "Agent reached its cost limit for this query.";
            break;
          default:
            userMessage = "Agent encountered an error — check server logs";
        }
        ws.send(JSON.stringify({ type: "error", message: userMessage }));
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
  let processing = false;
  let activeAbort: AbortController | undefined;

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

      if (processing) {
        console.warn("Message rejected — agent still processing", { conversationId });
        ws.send(JSON.stringify({ type: "error", message: "Agent is still working" }));
        return;
      }

      console.info("WS message received", { conversationId, content: msg.content.slice(0, 80) });

      processing = true;
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
        activeAbort = new AbortController();
        await streamQuery(ws, conversationId, msg.content, sessionId, activeAbort);
      } catch (err) {
        console.error("Agent error", { conversationId, error: err });
        ws.send(JSON.stringify({ type: "error", message: "Agent error — check server logs" }));
      } finally {
        activeAbort = undefined;
        processing = false;
      }
    },

    onClose: (evt, _ws) => {
      console.info("WebSocket closed", {
        conversationId,
        code: (evt as CloseEvent).code,
        reason: (evt as CloseEvent).reason,
      });
      if (activeAbort) {
        console.info("Aborting active agent query", { conversationId });
        activeAbort.abort();
        activeAbort = undefined;
      }
    },
  };
}
