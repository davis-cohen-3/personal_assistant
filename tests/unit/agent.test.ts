import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

const {
  mockGetConversation,
  mockCreateChatMessage,
  mockUpdateConversation,
  mockListMessagesByConversation,
} = vi.hoisted(() => ({
  mockGetConversation: vi.fn(),
  mockCreateChatMessage: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockListMessagesByConversation: vi.fn(),
}));

const { mockCreateCustomMcpServer } = vi.hoisted(() => ({
  mockCreateCustomMcpServer: vi.fn(),
}));

const { mockReaddir, mockReadFile } = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

vi.mock("../../src/server/db/queries.js", () => ({
  getConversation: mockGetConversation,
  createChatMessage: mockCreateChatMessage,
  updateConversation: mockUpdateConversation,
  listMessagesByConversation: mockListMessagesByConversation,
}));

vi.mock("../../src/server/tools.js", () => ({
  createCustomMcpServer: mockCreateCustomMcpServer,
}));

vi.mock("node:fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import {
  handleWebSocket,
  initAgent,
  streamQuery,
} from "../../src/server/agent.js";

async function* makeGen(messages: Array<Record<string, unknown>>) {
  for (const msg of messages) yield msg;
}

function makeMockWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    url: null as URL | null,
  } as unknown as WSContext;
}

function makeCtx(conversationId: string | null): Context {
  const url = conversationId
    ? `http://localhost:3000/ws?conversationId=${conversationId}`
    : "http://localhost:3000/ws";
  return { req: { url } } as unknown as Context;
}

describe("streamQuery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sends text_delta for each text token", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hello" },
          },
          session_id: "sess-1",
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: " world" },
          },
          session_id: "sess-1",
        },
        {
          type: "result",
          subtype: "success",
          result: "hello world",
          session_id: "sess-1",
        },
      ])
    );

    await streamQuery(ws, "conv-1", "tell me something");

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "text_delta", content: "hello" })
    );
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "text_delta", content: " world" })
    );
  });

  it("sends text_done with authoritative full result text", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "result",
          subtype: "success",
          result: "full response text",
          session_id: "sess-1",
        },
      ])
    );

    await streamQuery(ws, "conv-1", "prompt");

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "text_done", content: "full response text" })
    );
  });

  it("persists session_id and assistant message after completion", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "result",
          subtype: "success",
          result: "response",
          session_id: "sess-abc",
        },
      ])
    );

    await streamQuery(ws, "conv-1", "prompt");

    expect(mockUpdateConversation).toHaveBeenCalledWith("conv-1", {
      sdk_session_id: "sess-abc",
    });
    expect(mockCreateChatMessage).toHaveBeenCalledWith(
      "conv-1",
      "assistant",
      "response"
    );
  });

  it("passes sessionId as resume option to query", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "result",
          subtype: "success",
          result: "ok",
          session_id: "sess-1",
        },
      ])
    );

    await streamQuery(ws, "conv-1", "prompt", "existing-session");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ resume: "existing-session" }),
      })
    );
  });

  it("retries without resume when stale session throws (IMP-017)", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery
      .mockImplementationOnce(() => {
        throw new Error("stale session");
      })
      .mockReturnValueOnce(
        makeGen([
          {
            type: "result",
            subtype: "success",
            result: "retry result",
            session_id: "sess-new",
          },
        ])
      );

    await streamQuery(ws, "conv-1", "prompt", "stale-session-id");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const secondCallArg = mockQuery.mock.calls[1][0] as {
      options: { resume?: string };
    };
    expect(secondCallArg.options.resume).toBeUndefined();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "text_done", content: "retry result" })
    );
  });

  it("does not catch errors when no sessionId provided", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockQuery.mockImplementationOnce(() => {
      throw new Error("hard error");
    });

    await expect(streamQuery(ws, "conv-1", "prompt")).rejects.toThrow(
      "hard error"
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("skips non-text-delta stream events", async () => {
    const ws = makeMockWs();
    mockCreateCustomMcpServer.mockReturnValue({});
    mockCreateChatMessage.mockResolvedValue({});
    mockUpdateConversation.mockResolvedValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "stream_event",
          event: { type: "message_start" },
          session_id: "s1",
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "input_json_delta", partial_json: "{}" },
          },
          session_id: "s1",
        },
        {
          type: "result",
          subtype: "success",
          result: "done",
          session_id: "s1",
        },
      ])
    );

    await streamQuery(ws, "conv-1", "prompt");

    const textDeltaCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]: [string]) => {
        const parsed = JSON.parse(arg) as { type: string };
        return parsed.type === "text_delta";
      }
    );
    expect(textDeltaCalls).toHaveLength(0);
  });
});

describe("handleWebSocket", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sends error and closes if conversationId missing", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx(null);
    const events = handleWebSocket(ctx);

    await events.onOpen?.(new Event("open"), ws);

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "error", message: "Missing conversationId" })
    );
    expect(ws.close).toHaveBeenCalled();
  });

  it("does not send or close when conversationId is present on open", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    const events = handleWebSocket(ctx);

    await events.onOpen?.(new Event("open"), ws);

    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("sends error on invalid message format (wrong type)", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({ id: "conv-1", sdk_session_id: null });
    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const badMsg = new MessageEvent("message", {
      data: JSON.stringify({ type: "unknown" }),
    });
    await events.onMessage?.(badMsg, ws);

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "error", message: "Invalid message format" })
    );
  });

  it("sends error on invalid message format (empty content)", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({ id: "conv-1", sdk_session_id: null });
    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const badMsg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content: "" }),
    });
    await events.onMessage?.(badMsg, ws);

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "error", message: "Invalid message format" })
    );
  });

  it("persists user message on valid chat message", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({ id: "conv-1", sdk_session_id: null });
    mockCreateChatMessage.mockResolvedValue({});
    mockListMessagesByConversation.mockResolvedValue([
      { role: "user" },
      { role: "assistant" },
    ]); // >1 user msg, no auto-title
    mockUpdateConversation.mockResolvedValue({});
    mockCreateCustomMcpServer.mockReturnValue({});
    mockQuery.mockReturnValue(
      makeGen([
        { type: "result", subtype: "success", result: "ok", session_id: "s1" },
      ])
    );

    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const msg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content: "hello" }),
    });
    await events.onMessage?.(msg, ws);

    expect(mockCreateChatMessage).toHaveBeenCalledWith("conv-1", "user", "hello");
  });

  it("auto-titles conversation on first user message", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({ id: "conv-1", sdk_session_id: null });
    mockCreateChatMessage.mockResolvedValue({});
    mockListMessagesByConversation.mockResolvedValue([{ role: "user" }]); // exactly 1 user msg
    mockUpdateConversation.mockResolvedValue({});
    mockCreateCustomMcpServer.mockReturnValue({});
    mockQuery.mockReturnValue(
      makeGen([
        { type: "result", subtype: "success", result: "ok", session_id: "s1" },
      ])
    );

    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const content = "This is my first message to you assistant please help me";
    const msg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content }),
    });
    await events.onMessage?.(msg, ws);

    expect(mockUpdateConversation).toHaveBeenCalledWith("conv-1", {
      title: content.slice(0, 80),
    });
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "conversation_updated",
        conversationId: "conv-1",
        title: content.slice(0, 80),
      })
    );
  });

  it("truncates title to 80 chars", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({ id: "conv-1", sdk_session_id: null });
    mockCreateChatMessage.mockResolvedValue({});
    const longContent = "A".repeat(120);
    mockListMessagesByConversation.mockResolvedValue([{ role: "user" }]);
    mockUpdateConversation.mockResolvedValue({});
    mockCreateCustomMcpServer.mockReturnValue({});
    mockQuery.mockReturnValue(
      makeGen([
        { type: "result", subtype: "success", result: "ok", session_id: "s1" },
      ])
    );

    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const msg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content: longContent }),
    });
    await events.onMessage?.(msg, ws);

    expect(mockUpdateConversation).toHaveBeenCalledWith("conv-1", {
      title: "A".repeat(80),
    });
  });

  it("passes sdk_session_id as resume to streamQuery", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    mockGetConversation.mockResolvedValue({
      id: "conv-1",
      sdk_session_id: "existing-sess",
    });
    mockCreateChatMessage.mockResolvedValue({});
    mockListMessagesByConversation.mockResolvedValue([
      { role: "user" },
      { role: "user" },
    ]);
    mockUpdateConversation.mockResolvedValue({});
    mockCreateCustomMcpServer.mockReturnValue({});
    mockQuery.mockReturnValue(
      makeGen([
        {
          type: "result",
          subtype: "success",
          result: "ok",
          session_id: "existing-sess",
        },
      ])
    );

    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const msg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content: "hello" }),
    });
    await events.onMessage?.(msg, ws);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ resume: "existing-sess" }),
      })
    );
  });

  it("sends error and returns if conversation not found on message", async () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    // onOpen doesn't call getConversation — only onMessage does
    mockGetConversation.mockResolvedValueOnce(null);
    const events = handleWebSocket(ctx);
    await events.onOpen?.(new Event("open"), ws);

    const msg = new MessageEvent("message", {
      data: JSON.stringify({ type: "chat", content: "hello" }),
    });
    await events.onMessage?.(msg, ws);

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "error", message: "Conversation not found" })
    );
    expect(mockCreateChatMessage).not.toHaveBeenCalled();
  });

  it("onClose is a no-op", () => {
    const ws = makeMockWs();
    const ctx = makeCtx("conv-1");
    const events = handleWebSocket(ctx);
    // Should not throw — pass a minimal event-like object
    expect(() =>
      events.onClose?.({ type: "close" } as CloseEvent, ws)
    ).not.toThrow();
  });
});

describe("initAgent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("handles missing skills directory gracefully (ENOENT)", async () => {
    const enoentError = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    mockReaddir.mockRejectedValue(enoentError);

    await expect(initAgent()).resolves.toBeUndefined();
  });

  it("throws on non-ENOENT filesystem errors", async () => {
    const permError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    mockReaddir.mockRejectedValue(permError);

    await expect(initAgent()).rejects.toThrow("EACCES");
  });

  it("appends skill content to SYSTEM_PROMPT when directory exists", async () => {
    mockReaddir.mockResolvedValue([
      { isFile: () => true, isDirectory: () => false, name: "skill.md" },
    ]);
    mockReadFile.mockResolvedValue("# Skill Content");

    await expect(initAgent()).resolves.toBeUndefined();
    expect(mockReadFile).toHaveBeenCalled();
  });
});
