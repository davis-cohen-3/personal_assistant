# Claude Agent SDK Reference

> `@anthropic-ai/claude-agent-sdk` — the official SDK for building backend agents with Claude.
> This doc covers the actual API surface needed to implement the personal assistant agent.

---

## 1. Installation & Requirements

```bash
pnpm add @anthropic-ai/claude-agent-sdk
```

- **Node.js 18+** required
- **Zod ^3.24.1** required for tool schema definitions
- Requires `ANTHROPIC_API_KEY` env var

---

## 2. Core API: `query()`

The main entry point. Returns an async generator that streams messages.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function query({
  prompt: string | AsyncIterable<SDKUserMessage>,
  options?: Options
}): Query; // extends AsyncGenerator<SDKMessage, void>
```

### Options

| Parameter | Type | Description |
|---|---|---|
| `systemPrompt` | `string` | Custom system prompt |
| `model` | `string` | `"claude-opus-4-6"`, `"sonnet"`, `"haiku"` |
| `maxTurns` | `number` | Max turns before stopping |
| `maxBudgetUsd` | `number` | Cost limit in USD |
| `permissionMode` | `"default" \| "acceptEdits" \| "bypassPermissions" \| "dontAsk"` | How to handle permission requests |
| `allowedTools` | `string[]` | Whitelist of tools Claude can use |
| `disallowedTools` | `string[]` | Blacklist of tools |
| `canUseTool` | `(toolName: string) => Promise<boolean>` | Custom approval callback |
| `mcpServers` | `Record<string, MCPServerConfig>` | MCP servers to connect |
| `agents` | `Record<string, AgentDefinition>` | Subagents to make available |
| `continue` | `boolean` | Resume most recent session in cwd |
| `resume` | `string` | Resume specific session by ID |
| `forkSession` | `boolean` | Fork/branch the session |
| `persistSession` | `boolean` | Default `true`; set `false` for in-memory only |
| `env` | `Record<string, string>` | Env vars passed to MCP servers |
| `hooks` | `HookCallbacks` | Custom code execution hooks |

---

## 3. V2 Session API (Preview)

Simpler for multi-turn WebSocket chat. Separates send/stream.

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt
} from "@anthropic-ai/claude-agent-sdk";
```

### Create Session

```typescript
const session = unstable_v2_createSession({
  model: "claude-opus-4-6",
  systemPrompt: "You are a personal assistant...",
  mcpServers: { "assistant-tools": toolsServer },
  allowedTools: ["mcp__assistant-tools__sync_email", /* ... */]
});
// session.sessionId — unique ID for persistence
```

### Resume Session

```typescript
const session = unstable_v2_resumeSession(sessionId, {
  model: "claude-opus-4-6",
  // ... same options
});
```

### SDKSession Interface

```typescript
interface SDKSession {
  readonly sessionId: string;
  send(message: string | SDKUserMessage): Promise<void>;
  stream(): AsyncGenerator<SDKMessage, void>;
  close(): void;
}
```

### Multi-Turn Example

```typescript
await using session = unstable_v2_createSession({
  model: "claude-opus-4-6",
  systemPrompt: SYSTEM_PROMPT,
  mcpServers: { "assistant-tools": toolsServer }
});

// Turn 1
await session.send("Sync my inbox");
for await (const msg of session.stream()) {
  if (msg.type === "assistant") {
    ws.send(JSON.stringify({ type: "assistant", content: msg.message.content }));
  }
}

// Turn 2 — same session, full context preserved
await session.send("Now classify the new threads");
for await (const msg of session.stream()) {
  // ...stream to WebSocket
}

session.close(); // or auto-cleanup via `await using`
```

---

## 4. Defining Custom MCP Tools

### `tool()` — Define a Tool with Zod Schema

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

tool<Schema>(
  name: string,
  description: string,
  inputSchema: Schema,          // Zod raw shape (NOT z.object — just the shape)
  handler: (args) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): SdkMcpToolDefinition<Schema>;
```

### Handler Return Type

```typescript
interface CallToolResult {
  content: Array<{
    type: "text" | "image" | "document";
    text?: string;
    source?: ImageSource | DocumentSource;
  }>;
}
```

### `createSdkMcpServer()` — In-Process MCP Server

```typescript
const toolsServer = createSdkMcpServer({
  name: "assistant-tools",
  version: "1.0.0",
  tools: [
    tool("sync_email", "Read email data", {
      action: z.enum(["sync", "search", "get_thread", "get_unbucketed"]),
      query: z.string().optional(),
      max_results: z.number().optional(),
      thread_id: z.string().optional(),
    }, async (args) => {
      // Call email.ts orchestration layer
      const result = await handleSyncEmail(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),

    tool("action_email", "Send, reply, draft, archive, mark read", {
      action: z.enum(["send", "reply", "draft", "archive", "mark_read"]),
      to: z.string().optional(),
      cc: z.array(z.string()).optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      thread_id: z.string().optional(),
      message_id: z.string().optional(),
    }, async (args) => {
      const result = await handleActionEmail(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),

    tool("calendar", "Google Calendar operations", {
      action: z.enum(["list", "get", "create", "update", "delete", "free_busy"]),
      time_min: z.string().optional(),
      time_max: z.string().optional(),
      event_id: z.string().optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      attendees: z.array(z.string()).optional(),
      query: z.string().optional(),
    }, async (args) => {
      const result = await handleCalendar(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),

    tool("drive", "Search Drive files and read Google Docs", {
      action: z.enum(["search", "list_recent", "read", "metadata"]),
      query: z.string().optional(),
      file_id: z.string().optional(),
      max_results: z.number().optional(),
    }, async (args) => {
      const result = await handleDrive(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),

    tool("buckets", "Manage inbox buckets and assign threads", {
      action: z.enum(["list", "create", "update", "delete", "assign"]),
      name: z.string().optional(),
      description: z.string().optional(),
      bucket_id: z.string().optional(),
      assignments: z.array(z.object({
        thread_id: z.string(),
        bucket_id: z.string(),
      })).optional(),
    }, async (args) => {
      const result = await handleBuckets(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),
  ]
});
```

### MCP Tool Naming Convention

Tools are referenced as `mcp__{serverName}__{toolName}`:
- `sync_email` in server `assistant-tools` → `mcp__assistant-tools__sync_email`
- Use in `allowedTools`: `["mcp__assistant-tools__sync_email", ...]`

---

## 5. Subagents

### AgentDefinition

```typescript
interface AgentDefinition {
  description: string;   // When to use this agent (Claude reads this)
  prompt: string;        // System prompt for the subagent
  tools?: string[];      // Scoped tool access (inherits all if omitted)
  model?: "sonnet" | "opus" | "haiku" | "inherit";
}
```

### Configuration

```typescript
const agentOptions = {
  agents: {
    "email-classifier": {
      description: "Classifies email threads into buckets. Use for inbox triage and bulk classification.",
      prompt: `You are an email classification assistant. Sync the inbox, read bucket definitions,
then classify all unbucketed threads in batches of 25. For each thread, choose the most specific
matching bucket based on subject, sender, snippet, and body content.
Return a summary of what was classified and into which buckets.`,
      tools: ["mcp__assistant-tools__sync_email", "mcp__assistant-tools__buckets"],
      model: "haiku"
    },
    "meeting-prepper": {
      description: "Researches context for upcoming meetings. Use when prepping multiple meetings.",
      prompt: `You are a meeting prep assistant. For each meeting provided, research context:
search for recent email threads involving the attendees, search Drive for documents related
to the meeting topic. Return a structured briefing per meeting.`,
      tools: [
        "mcp__assistant-tools__calendar",
        "mcp__assistant-tools__sync_email",
        "mcp__assistant-tools__drive"
      ],
      model: "haiku"
    },
    "researcher": {
      description: "General-purpose cross-service search. Use for broad research queries.",
      prompt: `You are a research assistant. Search across email, calendar, and drive to find
information relevant to the user's query. Be thorough — check multiple search terms.
Return a concise summary with specific references.`,
      tools: [
        "mcp__assistant-tools__sync_email",
        "mcp__assistant-tools__calendar",
        "mcp__assistant-tools__drive"
      ],
      model: "haiku"
    }
  }
};
```

### Subagent Behavior

- Claude decides when to spawn based on `description` field
- Subagents don't see the parent conversation — they get only their system prompt + task
- Only the subagent's final message returns to the parent
- No nested subagents — subagents cannot spawn their own
- The main agent must include `"Agent"` in `allowedTools` to spawn subagents

### What Subagents Receive vs. Don't

| Receives | Does NOT Receive |
|---|---|
| Their system prompt | Parent conversation history |
| Project CLAUDE.md | Parent tool results |
| Scoped tool definitions | Parent system prompt |
| The Agent tool's prompt string | Other subagent context |

---

## 6. Streaming Message Types

```typescript
type SDKMessage =
  | SystemMessage       // Initialization
  | AssistantMessage    // Claude's response (text + tool_use blocks)
  | UserMessage         // User input
  | ToolUseMessage      // Tool invocation
  | ToolResultMessage   // Tool result
  | ResultMessage;      // Final result

interface SystemMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  mcp_servers: Array<{ name: string; status: "connected" | "failed" }>;
  tools: string[];
}

interface AssistantMessage {
  type: "assistant";
  session_id: string;
  message: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
  };
}

interface ResultMessage {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_max_budget_usd" | "error_during_execution" | "user_cancelled";
  session_id: string;
  result: string;
  total_cost_usd?: number;
  permission_denials?: Array<{ tool_name: string; reason: string }>;
}
```

---

## 7. Session Persistence

### Storage Location

Sessions stored as JSONL files at:
```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```
Where `<encoded-cwd>` replaces non-alphanumeric chars with `-`.

### Session Lifecycle

| Event | Behavior |
|---|---|
| New session created | Fresh `.jsonl` file, `session_id` returned in first message |
| `resume: sessionId` | Restores full context from disk |
| `continue: true` | Resumes most recent session in cwd |
| `forkSession: true` | Branches from existing session |
| `persistSession: false` | In-memory only, no disk write |
| Auto-compaction | SDK compacts when approaching context limit; transparent |
| Process restart | Session files persist on disk; resume by ID |

### Resume Patterns

```typescript
// Resume specific session
for await (const msg of query({
  prompt: "Follow-up message",
  options: { resume: savedSessionId }
})) { /* ... */ }

// Continue most recent
for await (const msg of query({
  prompt: "Next task",
  options: { continue: true }
})) { /* ... */ }

// Fork from existing
for await (const msg of query({
  prompt: "Try different approach",
  options: { resume: sessionId, forkSession: true }
})) { /* ... */ }
```

---

## 8. Permission Modes

| Mode | Behavior | Use Case |
|---|---|---|
| `"default"` | Requires `canUseTool` callback | Interactive approval |
| `"acceptEdits"` | Auto-approves file edits | Trusted dev workflows |
| `"bypassPermissions"` | Skips all prompts | Sandboxed/headless (use with care) |
| `"dontAsk"` | Denies anything not in `allowedTools` | Locked-down agents |

For our agent: use `"bypassPermissions"` since all tools are our own in-process MCP tools and we enforce approval at the prompt level for write operations.

---

## 9. Putting It Together — Agent Setup for This Project

```typescript
// src/server/agent.ts
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const SYSTEM_PROMPT = `You are a personal assistant...`;

// 1. Create in-process MCP server with 5 tools
const toolsServer = createSdkMcpServer({
  name: "assistant-tools",
  version: "1.0.0",
  tools: [/* sync_email, action_email, calendar, drive, buckets */]
});

// 2. Define agent options
const agentOptions = {
  systemPrompt: SYSTEM_PROMPT,
  model: "claude-opus-4-6",
  mcpServers: { "assistant-tools": toolsServer },
  allowedTools: [
    "mcp__assistant-tools__sync_email",
    "mcp__assistant-tools__action_email",
    "mcp__assistant-tools__calendar",
    "mcp__assistant-tools__drive",
    "mcp__assistant-tools__buckets",
    "Agent"  // Required to spawn subagents
  ],
  agents: {
    "email-classifier": { /* ... */ },
    "meeting-prepper": { /* ... */ },
    "researcher": { /* ... */ }
  },
  permissionMode: "bypassPermissions" as const,
};

// 3. Stream to WebSocket
export async function handleAgentMessage(
  prompt: string,
  sessionId: string | undefined,
  ws: WebSocket
) {
  const options = sessionId
    ? { ...agentOptions, resume: sessionId }
    : agentOptions;

  for await (const msg of query({ prompt, options })) {
    if ("session_id" in msg && !sessionId) {
      sessionId = msg.session_id;
      // Persist sessionId to conversations table
    }

    if (msg.type === "assistant") {
      ws.send(JSON.stringify({
        type: "assistant",
        content: msg.message.content
      }));
    }

    if (msg.type === "result") {
      ws.send(JSON.stringify({
        type: "result",
        subtype: msg.subtype,
        result: msg.result,
        sessionId,
        cost: msg.total_cost_usd
      }));
    }
  }
}
```

---

## Sources

- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [V2 Preview API](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Sessions & Persistence](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [MCP Configuration](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
