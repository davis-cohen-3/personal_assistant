import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSearchThreads,
  mockGetThread,
  mockSendMessage,
  mockReplyToThread,
  mockCreateDraft,
  mockTrashThread,
  mockMarkAsRead,
} = vi.hoisted(() => ({
  mockSearchThreads: vi.fn(),
  mockGetThread: vi.fn(),
  mockSendMessage: vi.fn(),
  mockReplyToThread: vi.fn(),
  mockCreateDraft: vi.fn(),
  mockTrashThread: vi.fn(),
  mockMarkAsRead: vi.fn(),
}));

const {
  mockListEmailThreadsByGmailIds,
  mockUpsertEmailThread,
  mockUpsertEmailMessages,
  mockGetEmailThread,
  mockGetUnbucketedThreads,
  mockUnassignThread,
} = vi.hoisted(() => ({
  mockListEmailThreadsByGmailIds: vi.fn(),
  mockUpsertEmailThread: vi.fn(),
  mockUpsertEmailMessages: vi.fn(),
  mockGetEmailThread: vi.fn(),
  mockGetUnbucketedThreads: vi.fn(),
  mockUnassignThread: vi.fn(),
}));

vi.mock("../../src/server/google/gmail.js", () => ({
  searchThreads: mockSearchThreads,
  getThread: mockGetThread,
  sendMessage: mockSendMessage,
  replyToThread: mockReplyToThread,
  createDraft: mockCreateDraft,
  trashThread: mockTrashThread,
  markAsRead: mockMarkAsRead,
}));

vi.mock("../../src/server/db/queries.js", () => ({
  listEmailThreadsByGmailIds: mockListEmailThreadsByGmailIds,
  upsertEmailThread: mockUpsertEmailThread,
  upsertEmailMessages: mockUpsertEmailMessages,
  getEmailThread: mockGetEmailThread,
  getUnbucketedThreads: mockGetUnbucketedThreads,
  unassignThread: mockUnassignThread,
}));

import * as email from "../../src/server/email.js";

function makeGmailMessage(overrides: {
  id?: string;
  threadId?: string;
  snippet?: string;
  subject?: string;
  from?: string;
  to?: string;
  internalDate?: string;
  bodyText?: string;
  bodyHtml?: string;
  labelIds?: string[];
} = {}) {
  return {
    id: overrides.id ?? "msg-1",
    threadId: overrides.threadId ?? "thread-1",
    labelIds: overrides.labelIds ?? ["INBOX", "UNREAD"],
    snippet: overrides.snippet ?? "Hello world",
    internalDate: overrides.internalDate ?? "1700000000000",
    subject: overrides.subject ?? "Test Subject",
    from: overrides.from ?? "Alice <alice@example.com>",
    to: overrides.to ?? "bob@example.com",
    date: "Mon, 1 Jan 2024 12:00:00 +0000",
    bodyText: overrides.bodyText ?? "Hello world plain text",
    bodyHtml: overrides.bodyHtml ?? "<p>Hello world</p>",
  };
}

function makeGmailThread(
  id: string = "thread-1",
  messages = [makeGmailMessage()],
) {
  return { id, messages };
}

function makeThreadSummary(id: string = "thread-1", snippet: string = "Hello world") {
  return { id, snippet };
}

function makeDbThread(gmailThreadId: string = "thread-1", snippet: string = "Hello world") {
  return { gmail_thread_id: gmailThreadId, snippet, subject: "Test Subject" };
}

describe("extractBodyText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEmailThread.mockResolvedValue({});
    mockUpsertEmailMessages.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);
  });

  it("returns bodyText when non-empty", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary()]);
    const msg = makeGmailMessage({ bodyText: "plain text content", bodyHtml: "<p>html</p>" });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));

    await email.syncInbox();

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].body_text).toBe("plain text content");
  });

  it("strips HTML tags and style blocks when bodyText is empty", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary()]);
    const msg = makeGmailMessage({
      bodyText: "",
      bodyHtml: "<style>body { color: red; }</style><p>Promo <b>deal</b></p>",
    });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));

    await email.syncInbox();

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].body_text).toBe("Promo deal");
  });

  it("collapses extra whitespace in stripped HTML result", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary()]);
    const msg = makeGmailMessage({
      bodyText: "",
      bodyHtml: "<p>Hello&nbsp;&nbsp;world</p>   <span>  more  </span>",
    });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));

    await email.syncInbox();

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].body_text).toBe("Hello world more");
  });

  it("returns empty string when both bodyText and bodyHtml are empty", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary()]);
    const msg = makeGmailMessage({ bodyText: "", bodyHtml: "" });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));

    await email.syncInbox();

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].body_text).toBe("");
  });
});

describe("syncInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEmailThread.mockResolvedValue({});
    mockUpsertEmailMessages.mockResolvedValue([]);
  });

  it("returns { new: 0, updated: 0 } when inbox is empty", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    const result = await email.syncInbox();

    expect(result).toEqual({ new: 0, updated: 0 });
    expect(mockGetThread).not.toHaveBeenCalled();
  });

  it("passes DEFAULT_SYNC_LIMIT (200) to searchThreads when maxResults not provided", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    await email.syncInbox();

    expect(mockSearchThreads).toHaveBeenCalledWith("is:inbox", 200);
  });

  it("passes provided maxResults to searchThreads", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    await email.syncInbox(50);

    expect(mockSearchThreads).toHaveBeenCalledWith("is:inbox", 50);
  });

  it("fetches and upserts a new thread not in DB", async () => {
    const summary = makeThreadSummary("thread-1", "New email snippet");
    mockSearchThreads.mockResolvedValue([summary]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));

    const result = await email.syncInbox();

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(mockUpsertEmailThread).toHaveBeenCalledTimes(1);
    expect(mockUpsertEmailMessages).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ new: 1, updated: 0 });
  });

  it("skips a thread already in DB with matching snippet", async () => {
    const summary = makeThreadSummary("thread-1", "Same snippet");
    mockSearchThreads.mockResolvedValue([summary]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([makeDbThread("thread-1", "Same snippet")]);

    await email.syncInbox();

    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockUpsertEmailThread).not.toHaveBeenCalled();
  });

  it("fetches and upserts a thread with a changed snippet", async () => {
    const summary = makeThreadSummary("thread-1", "Updated snippet");
    mockSearchThreads.mockResolvedValue([summary]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([makeDbThread("thread-1", "Old snippet")]);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));

    const result = await email.syncInbox();

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(result).toEqual({ new: 0, updated: 1 });
  });

  it("returns correct counts for mixed new, changed, and unchanged threads", async () => {
    mockSearchThreads.mockResolvedValue([
      makeThreadSummary("new-thread", "New"),
      makeThreadSummary("changed-thread", "Changed snippet"),
      makeThreadSummary("same-thread", "Same snippet"),
    ]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([
      makeDbThread("changed-thread", "Old snippet"),
      makeDbThread("same-thread", "Same snippet"),
    ]);
    mockGetThread.mockImplementation((id: string) =>
      Promise.resolve(makeGmailThread(id)),
    );

    const result = await email.syncInbox();

    expect(mockGetThread).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ new: 1, updated: 1 });
  });

  it("stores the gmail_thread_id in the upserted thread record", async () => {
    const summary = makeThreadSummary("thread-42", "snippet");
    mockSearchThreads.mockResolvedValue([summary]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-42"));

    await email.syncInbox();

    const [threadRecord] = mockUpsertEmailThread.mock.lastCall!;
    expect(threadRecord.gmail_thread_id).toBe("thread-42");
  });

  it("passes message gmail_thread_id and gmail_message_id when upserting messages", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary("thread-1")]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);
    const msg = makeGmailMessage({ id: "msg-abc", threadId: "thread-1" });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));

    await email.syncInbox();

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].gmail_message_id).toBe("msg-abc");
    expect(messages[0].gmail_thread_id).toBe("thread-1");
  });
});

describe("search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEmailThread.mockResolvedValue({});
    mockUpsertEmailMessages.mockResolvedValue([]);
  });

  it("returns empty array when no results", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    const result = await email.search("from:nobody@example.com");

    expect(result).toEqual([]);
    expect(mockGetThread).not.toHaveBeenCalled();
  });

  it("syncs found threads to DB and returns them from DB", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary("thread-1")]);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));
    const dbThread = makeDbThread("thread-1");
    mockListEmailThreadsByGmailIds.mockResolvedValue([dbThread]);

    const result = await email.search("from:alice@example.com");

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(mockUpsertEmailThread).toHaveBeenCalledTimes(1);
    expect(mockUpsertEmailMessages).toHaveBeenCalledTimes(1);
    expect(result).toEqual([dbThread]);
  });

  it("caps resultLimit at BATCH_SIZE (25) when maxResults is not provided", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    await email.search("is:unread");

    expect(mockSearchThreads).toHaveBeenCalledWith("is:unread", 25);
  });

  it("caps resultLimit at BATCH_SIZE when maxResults exceeds it", async () => {
    mockSearchThreads.mockResolvedValue([]);
    mockListEmailThreadsByGmailIds.mockResolvedValue([]);

    await email.search("is:unread", 100);

    expect(mockSearchThreads).toHaveBeenCalledWith("is:unread", 25);
  });

  it("applies extractBodyText to messages before upserting", async () => {
    mockSearchThreads.mockResolvedValue([makeThreadSummary("thread-1")]);
    const msg = makeGmailMessage({ bodyText: "", bodyHtml: "<p>Promo content</p>" });
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1", [msg]));
    mockListEmailThreadsByGmailIds.mockResolvedValue([makeDbThread("thread-1")]);

    await email.search("label:promotions");

    const [messages] = mockUpsertEmailMessages.mock.lastCall!;
    expect(messages[0].body_text).toBe("Promo content");
  });
});

describe("getThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEmailThread.mockResolvedValue({});
    mockUpsertEmailMessages.mockResolvedValue([]);
  });

  it("returns cached thread from DB when messages exist", async () => {
    const dbThread = { ...makeDbThread("thread-1"), messages: [{ gmail_message_id: "msg-1" }] };
    mockGetEmailThread.mockResolvedValue(dbThread);

    const result = await email.getThread("thread-1");

    expect(result).toBe(dbThread);
    expect(mockGetThread).not.toHaveBeenCalled();
    expect(mockUpsertEmailThread).not.toHaveBeenCalled();
  });

  it("fetches from Gmail and upserts when not in DB", async () => {
    mockGetEmailThread.mockResolvedValueOnce(null);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));
    const dbThread = { ...makeDbThread("thread-1"), messages: [{ gmail_message_id: "msg-1" }] };
    mockGetEmailThread.mockResolvedValueOnce(dbThread);

    const result = await email.getThread("thread-1");

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(mockUpsertEmailThread).toHaveBeenCalledTimes(1);
    expect(mockUpsertEmailMessages).toHaveBeenCalledTimes(1);
    expect(result).toBe(dbThread);
  });

  it("fetches from Gmail when cached thread has no messages", async () => {
    const emptyThread = { ...makeDbThread("thread-1"), messages: [] };
    mockGetEmailThread.mockResolvedValueOnce(emptyThread);
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));
    const fullThread = { ...makeDbThread("thread-1"), messages: [{ gmail_message_id: "msg-1" }] };
    mockGetEmailThread.mockResolvedValueOnce(fullThread);

    const result = await email.getThread("thread-1");

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(result).toBe(fullThread);
  });
});

describe("getUnbucketedThreads", () => {
  it("returns unbucketed threads with count", async () => {
    const threads = [makeDbThread("t-1"), makeDbThread("t-2")];
    mockGetUnbucketedThreads.mockResolvedValue(threads);

    const result = await email.getUnbucketedThreads();

    expect(result).toEqual({ unbucketed: 2, threads });
  });

  it("passes BATCH_SIZE (25) as limit to the query", async () => {
    mockGetUnbucketedThreads.mockResolvedValue([]);

    await email.getUnbucketedThreads();

    expect(mockGetUnbucketedThreads).toHaveBeenCalledWith(25);
  });
});

describe("sendMessage", () => {
  it("delegates to gmail.sendMessage with same arguments", async () => {
    mockSendMessage.mockResolvedValue(undefined);

    await email.sendMessage("to@example.com", "Subject", "Body", { cc: ["cc@example.com"] });

    expect(mockSendMessage).toHaveBeenCalledWith("to@example.com", "Subject", "Body", {
      cc: ["cc@example.com"],
    });
  });
});

describe("replyToThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyToThread.mockResolvedValue(undefined);
    mockUpsertEmailThread.mockResolvedValue({});
    mockUpsertEmailMessages.mockResolvedValue([]);
  });

  it("delegates to gmail.replyToThread with same arguments", async () => {
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));

    await email.replyToThread("thread-1", "msg-1", "Reply body");

    expect(mockReplyToThread).toHaveBeenCalledWith("thread-1", "msg-1", "Reply body");
  });

  it("re-syncs thread to DB after sending reply", async () => {
    mockGetThread.mockResolvedValue(makeGmailThread("thread-1"));

    await email.replyToThread("thread-1", "msg-1", "Reply body");

    expect(mockGetThread).toHaveBeenCalledWith("thread-1");
    expect(mockUpsertEmailThread).toHaveBeenCalledTimes(1);
    expect(mockUpsertEmailMessages).toHaveBeenCalledTimes(1);
  });
});

describe("createDraft", () => {
  it("delegates to gmail.createDraft with same arguments", async () => {
    mockCreateDraft.mockResolvedValue("draft-id-1");

    const result = await email.createDraft("to@example.com", "Draft subject", "Draft body", "thread-1");

    expect(mockCreateDraft).toHaveBeenCalledWith(
      "to@example.com",
      "Draft subject",
      "Draft body",
      "thread-1",
    );
    expect(result).toBe("draft-id-1");
  });
});

describe("trashThread", () => {
  it("delegates to gmail.trashThread and unassigns from bucket", async () => {
    mockTrashThread.mockResolvedValue(undefined);
    mockUnassignThread.mockResolvedValue(undefined);

    await email.trashThread("thread-1");

    expect(mockTrashThread).toHaveBeenCalledWith("thread-1");
    expect(mockUnassignThread).toHaveBeenCalledWith("thread-1");
  });
});

describe("markAsRead", () => {
  it("delegates to gmail.markAsRead with same message ID", async () => {
    mockMarkAsRead.mockResolvedValue(undefined);

    await email.markAsRead("msg-1");

    expect(mockMarkAsRead).toHaveBeenCalledWith("msg-1");
  });
});
