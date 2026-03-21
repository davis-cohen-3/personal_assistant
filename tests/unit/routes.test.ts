import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { AppError } from "../../src/server/exceptions.js";

const {
  mockEmailSearch,
  mockEmailGetThread,
  mockEmailSendMessage,
  mockEmailReplyToThread,
  mockEmailArchiveThread,
  mockEmailMarkAsRead,
} = vi.hoisted(() => ({
  mockEmailSearch: vi.fn(),
  mockEmailGetThread: vi.fn(),
  mockEmailSendMessage: vi.fn(),
  mockEmailReplyToThread: vi.fn(),
  mockEmailArchiveThread: vi.fn(),
  mockEmailMarkAsRead: vi.fn(),
}));

const {
  mockCalendarListEvents,
  mockCalendarGetEvent,
  mockCalendarCreateEvent,
  mockCalendarUpdateEvent,
  mockCalendarDeleteEvent,
} = vi.hoisted(() => ({
  mockCalendarListEvents: vi.fn(),
  mockCalendarGetEvent: vi.fn(),
  mockCalendarCreateEvent: vi.fn(),
  mockCalendarUpdateEvent: vi.fn(),
  mockCalendarDeleteEvent: vi.fn(),
}));

const {
  mockListBucketsWithThreads,
  mockCreateBucket,
  mockMarkAllForRebucket,
  mockUpdateBucket,
  mockDeleteBucket,
  mockAssignThread,
  mockListBucketTemplates,
  mockGetBucketTemplate,
  mockApplyBucketTemplate,
  mockListConversations,
  mockCreateConversation,
  mockGetConversation,
  mockUpdateConversation,
  mockDeleteConversation,
  mockListMessagesByConversation,
} = vi.hoisted(() => ({
  mockListBucketsWithThreads: vi.fn(),
  mockCreateBucket: vi.fn(),
  mockMarkAllForRebucket: vi.fn(),
  mockUpdateBucket: vi.fn(),
  mockDeleteBucket: vi.fn(),
  mockAssignThread: vi.fn(),
  mockListBucketTemplates: vi.fn(),
  mockGetBucketTemplate: vi.fn(),
  mockApplyBucketTemplate: vi.fn(),
  mockListConversations: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockGetConversation: vi.fn(),
  mockUpdateConversation: vi.fn(),
  mockDeleteConversation: vi.fn(),
  mockListMessagesByConversation: vi.fn(),
}));

vi.mock("../../src/server/email.js", () => ({
  search: mockEmailSearch,
  getThread: mockEmailGetThread,
  sendMessage: mockEmailSendMessage,
  replyToThread: mockEmailReplyToThread,
  archiveThread: mockEmailArchiveThread,
  markAsRead: mockEmailMarkAsRead,
}));

vi.mock("../../src/server/google/calendar.js", () => ({
  listEvents: mockCalendarListEvents,
  getEvent: mockCalendarGetEvent,
  createEvent: mockCalendarCreateEvent,
  updateEvent: mockCalendarUpdateEvent,
  deleteEvent: mockCalendarDeleteEvent,
}));

vi.mock("../../src/server/db/queries.js", () => ({
  listBucketsWithThreads: mockListBucketsWithThreads,
  createBucket: mockCreateBucket,
  markAllForRebucket: mockMarkAllForRebucket,
  updateBucket: mockUpdateBucket,
  deleteBucket: mockDeleteBucket,
  assignThread: mockAssignThread,
  listBucketTemplates: mockListBucketTemplates,
  getBucketTemplate: mockGetBucketTemplate,
  applyBucketTemplate: mockApplyBucketTemplate,
  listConversations: mockListConversations,
  createConversation: mockCreateConversation,
  getConversation: mockGetConversation,
  updateConversation: mockUpdateConversation,
  deleteConversation: mockDeleteConversation,
  listMessagesByConversation: mockListMessagesByConversation,
}));

import { apiRoutes } from "../../src/server/routes.js";

function createTestApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 400);
    }
    if (err instanceof AppError) {
      const message = err.userFacing ? err.message : "Internal server error";
      return c.json({ error: message }, err.status as ContentfulStatusCode);
    }
    return c.json({ error: "Internal server error" }, 500);
  });
  app.route("/api", apiRoutes);
  return app;
}

const app = createTestApp();

function jsonBody(data: unknown) {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Gmail routes ────────────────────────────────────────────────────────────

describe("GET /api/gmail/threads", () => {
  it("returns 200 with threads array", async () => {
    const threads = [{ gmail_thread_id: "thread-1", subject: "Hello" }];
    mockEmailSearch.mockResolvedValue(threads);

    const res = await app.request("/api/gmail/threads");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(threads);
    expect(mockEmailSearch).toHaveBeenCalledWith("is:inbox", 25);
  });

  it("returns 400 when maxResults exceeds 25", async () => {
    const res = await app.request("/api/gmail/threads?maxResults=99");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 when maxResults is not a number", async () => {
    const res = await app.request("/api/gmail/threads?maxResults=abc");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });
});

describe("GET /api/gmail/threads/:id", () => {
  it("returns 200 with thread", async () => {
    const thread = { gmail_thread_id: "thread-1", subject: "Hello", messages: [] };
    mockEmailGetThread.mockResolvedValue(thread);

    const res = await app.request("/api/gmail/threads/thread-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(thread);
    expect(mockEmailGetThread).toHaveBeenCalledWith("thread-1");
  });
});

describe("POST /api/gmail/send", () => {
  it("returns 201 and calls email.sendMessage", async () => {
    const sentResult = { messageId: "msg-123" };
    mockEmailSendMessage.mockResolvedValue(sentResult);

    const res = await app.request("/api/gmail/send", {
      method: "POST",
      ...jsonBody({ to: "alice@example.com", subject: "Hi", body: "Hello!" }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(sentResult);
    expect(mockEmailSendMessage).toHaveBeenCalledWith(
      "alice@example.com",
      "Hi",
      "Hello!",
      { cc: undefined },
    );
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await app.request("/api/gmail/send", {
      method: "POST",
      ...jsonBody({ to: "not-an-email" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });
});

describe("POST /api/gmail/threads/:id/reply", () => {
  it("returns 201 and calls email.replyToThread", async () => {
    const replyResult = { messageId: "msg-456" };
    mockEmailReplyToThread.mockResolvedValue(replyResult);

    const res = await app.request("/api/gmail/threads/thread-1/reply", {
      method: "POST",
      ...jsonBody({ body: "Reply text", messageId: "msg-original" }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(replyResult);
    expect(mockEmailReplyToThread).toHaveBeenCalledWith("thread-1", "msg-original", "Reply text");
  });

  it("returns 400 when body is missing", async () => {
    const res = await app.request("/api/gmail/threads/thread-1/reply", {
      method: "POST",
      ...jsonBody({ messageId: "msg-original" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("returns 400 when messageId is missing", async () => {
    const res = await app.request("/api/gmail/threads/thread-1/reply", {
      method: "POST",
      ...jsonBody({ body: "Reply text" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });
});

describe("POST /api/gmail/threads/:id/archive", () => {
  it("returns 200 { ok: true }", async () => {
    mockEmailArchiveThread.mockResolvedValue(undefined);

    const res = await app.request("/api/gmail/threads/thread-1/archive", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockEmailArchiveThread).toHaveBeenCalledWith("thread-1");
  });
});

describe("POST /api/gmail/messages/:id/read", () => {
  it("returns 200 { ok: true }", async () => {
    mockEmailMarkAsRead.mockResolvedValue(undefined);

    const res = await app.request("/api/gmail/messages/msg-1/read", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockEmailMarkAsRead).toHaveBeenCalledWith("msg-1");
  });
});

// ─── Calendar routes ─────────────────────────────────────────────────────────

describe("GET /api/calendar/events", () => {
  it("returns 200 with events array", async () => {
    const events = [{ id: "event-1", summary: "Meeting" }];
    mockCalendarListEvents.mockResolvedValue(events);

    const res = await app.request("/api/calendar/events");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
    expect(mockCalendarListEvents).toHaveBeenCalled();
  });

  it("returns 400 when maxResults exceeds 25", async () => {
    const res = await app.request("/api/calendar/events?maxResults=99");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("returns 400 when timeMin is not a valid datetime", async () => {
    const res = await app.request("/api/calendar/events?timeMin=not-a-date");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });
});

describe("POST /api/calendar/events", () => {
  it("returns 201 and calls calendar.createEvent", async () => {
    const event = { id: "event-new", summary: "Team sync" };
    mockCalendarCreateEvent.mockResolvedValue(event);

    const res = await app.request("/api/calendar/events", {
      method: "POST",
      ...jsonBody({
        summary: "Team sync",
        start: "2026-03-21T10:00:00.000Z",
        end: "2026-03-21T11:00:00.000Z",
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(event);
    expect(mockCalendarCreateEvent).toHaveBeenCalled();
  });
});

// ─── Bucket routes ────────────────────────────────────────────────────────────

describe("GET /api/buckets", () => {
  it("returns 200 with buckets array", async () => {
    const buckets = [{ id: "bucket-1", name: "Inbox", threads: [] }];
    mockListBucketsWithThreads.mockResolvedValue(buckets);

    const res = await app.request("/api/buckets");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(buckets);
  });
});

describe("POST /api/buckets", () => {
  it("returns 201, calls createBucket and markAllForRebucket, includes rebucket_required", async () => {
    const bucket = { id: "bucket-new", name: "Work", description: "Work emails" };
    mockCreateBucket.mockResolvedValue(bucket);
    mockMarkAllForRebucket.mockResolvedValue(undefined);

    const res = await app.request("/api/buckets", {
      method: "POST",
      ...jsonBody({ name: "Work", description: "Work emails" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rebucket_required).toBe(true);
    expect(body.name).toBe("Work");
    expect(mockCreateBucket).toHaveBeenCalledWith("Work", "Work emails");
    expect(mockMarkAllForRebucket).toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request("/api/buckets", {
      method: "POST",
      ...jsonBody({ description: "No name" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });
});

describe("POST /api/buckets/assign", () => {
  it("returns 200 { ok: true } and does NOT match /:id route", async () => {
    mockAssignThread.mockResolvedValue(undefined);

    const res = await app.request("/api/buckets/assign", {
      method: "POST",
      ...jsonBody({
        gmail_thread_id: "thread-1",
        bucket_id: "00000000-0000-0000-0000-000000000001",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockAssignThread).toHaveBeenCalledWith(
      "thread-1",
      "00000000-0000-0000-0000-000000000001",
      undefined,
      undefined,
    );
  });
});

describe("PATCH /api/buckets/:id", () => {
  it("returns 200 with updated bucket", async () => {
    const updated = { id: "bucket-1", name: "Updated", description: "Updated desc" };
    mockUpdateBucket.mockResolvedValue(updated);

    const res = await app.request("/api/buckets/bucket-1", {
      method: "PATCH",
      ...jsonBody({ name: "Updated" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(mockUpdateBucket).toHaveBeenCalledWith("bucket-1", { name: "Updated" });
  });
});

describe("DELETE /api/buckets/:id", () => {
  it("returns 200 { ok: true }", async () => {
    mockDeleteBucket.mockResolvedValue(undefined);

    const res = await app.request("/api/buckets/bucket-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDeleteBucket).toHaveBeenCalledWith("bucket-1");
  });
});

// ─── Bucket template routes ───────────────────────────────────────────────────

describe("GET /api/bucket-templates", () => {
  it("returns 200 with templates", async () => {
    const templates = [{ id: "tmpl-1", name: "Default" }];
    mockListBucketTemplates.mockResolvedValue(templates);

    const res = await app.request("/api/bucket-templates");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(templates);
  });
});

describe("GET /api/bucket-templates/:id", () => {
  it("returns 200 with template", async () => {
    const template = { id: "tmpl-1", name: "Default", buckets: [] };
    mockGetBucketTemplate.mockResolvedValue(template);

    const res = await app.request("/api/bucket-templates/tmpl-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(template);
  });
});

describe("POST /api/bucket-templates/:id/apply", () => {
  it("returns 201 with applied buckets", async () => {
    const buckets = [{ id: "bucket-1", name: "Work" }];
    mockApplyBucketTemplate.mockResolvedValue(buckets);

    const res = await app.request("/api/bucket-templates/tmpl-1/apply", { method: "POST" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(buckets);
    expect(mockApplyBucketTemplate).toHaveBeenCalledWith("tmpl-1");
  });
});

// ─── Conversation routes ──────────────────────────────────────────────────────

describe("GET /api/conversations", () => {
  it("returns 200 with conversations", async () => {
    const convos = [{ id: "convo-1", title: "Chat 1" }];
    mockListConversations.mockResolvedValue(convos);

    const res = await app.request("/api/conversations");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(convos);
  });
});

describe("POST /api/conversations", () => {
  it("returns 201 with created conversation", async () => {
    const convo = { id: "convo-new", title: "New conversation" };
    mockCreateConversation.mockResolvedValue(convo);

    const res = await app.request("/api/conversations", {
      method: "POST",
      ...jsonBody({}),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(convo);
    expect(mockCreateConversation).toHaveBeenCalledWith("New conversation");
  });
});

describe("GET /api/conversations/:id", () => {
  it("returns 200 with conversation and messages", async () => {
    const convo = { id: "convo-1", title: "Chat 1" };
    const messages = [{ id: "msg-1", content: "Hello" }];
    mockGetConversation.mockResolvedValue(convo);
    mockListMessagesByConversation.mockResolvedValue(messages);

    const res = await app.request("/api/conversations/convo-1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("convo-1");
    expect(body.messages).toEqual(messages);
  });
});

describe("PATCH /api/conversations/:id", () => {
  it("returns 200 with updated conversation", async () => {
    const updated = { id: "convo-1", title: "New title" };
    mockUpdateConversation.mockResolvedValue(updated);

    const res = await app.request("/api/conversations/convo-1", {
      method: "PATCH",
      ...jsonBody({ title: "New title" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(mockUpdateConversation).toHaveBeenCalledWith("convo-1", { title: "New title" });
  });
});

describe("DELETE /api/conversations/:id", () => {
  it("returns 200 { ok: true }", async () => {
    mockDeleteConversation.mockResolvedValue(undefined);

    const res = await app.request("/api/conversations/convo-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDeleteConversation).toHaveBeenCalledWith("convo-1");
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("AppError error handling", () => {
  it("exposes message when userFacing is true", async () => {
    mockEmailGetThread.mockRejectedValue(
      new AppError("Thread not found", 404, { userFacing: true }),
    );

    const res = await app.request("/api/gmail/threads/missing-thread");

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Thread not found");
  });

  it("returns 'Internal server error' when userFacing is false", async () => {
    mockEmailGetThread.mockRejectedValue(
      new AppError("DB connection failed", 500, { userFacing: false }),
    );

    const res = await app.request("/api/gmail/threads/any-thread");

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});
