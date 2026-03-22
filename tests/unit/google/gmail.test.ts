import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMessagesGet,
  mockMessagesSend,
  mockMessagesModify,
  mockThreadsGet,
  mockThreadsList,
  mockThreadsModify,
  mockThreadsTrash,
  mockDraftsCreate,
  mockLabelsList,
  mockGetProfile,
  mockMimeMsg,
} = vi.hoisted(() => {
  const mockMimeMsg = {
    setSender: vi.fn(),
    setRecipient: vi.fn(),
    setSubject: vi.fn(),
    setHeader: vi.fn(),
    addMessage: vi.fn(),
    addAttachment: vi.fn(),
    asEncoded: vi.fn(() => "encoded-mime-string"),
  };
  return {
    mockMessagesGet: vi.fn(),
    mockMessagesSend: vi.fn(),
    mockMessagesModify: vi.fn(),
    mockThreadsGet: vi.fn(),
    mockThreadsList: vi.fn(),
    mockThreadsModify: vi.fn(),
    mockThreadsTrash: vi.fn(),
    mockDraftsCreate: vi.fn(),
    mockLabelsList: vi.fn(),
    mockGetProfile: vi.fn(),
    mockMimeMsg,
  };
});

vi.mock("googleapis", () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: {
          get: mockMessagesGet,
          send: mockMessagesSend,
          modify: mockMessagesModify,
        },
        threads: {
          get: mockThreadsGet,
          list: mockThreadsList,
          modify: mockThreadsModify,
          trash: mockThreadsTrash,
        },
        drafts: {
          create: mockDraftsCreate,
        },
        labels: {
          list: mockLabelsList,
        },
        getProfile: mockGetProfile,
      },
    })),
  },
}));

vi.mock("mimetext", () => ({
  createMimeMessage: vi.fn(() => mockMimeMsg),
}));

vi.mock("../../../src/server/google/auth.js", () => ({
  getAuthClient: vi.fn(() => ({})),
}));

import type { EmailAttachment } from "../../../src/server/google/gmail.js";
import {
  trashThread,
  createDraft,
  getMessage,
  getThread,
  listLabels,
  markAsRead,
  modifyLabels,
  replyToThread,
  searchThreads,
  sendMessage,
} from "../../../src/server/google/gmail.js";

const makePayload = (text: string, html?: string) => ({
  mimeType: "multipart/alternative",
  headers: [
    { name: "Subject", value: "Test Subject" },
    { name: "From", value: "alice@example.com" },
    { name: "To", value: "bob@example.com" },
    { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" },
  ],
  parts: [
    { mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64url") } },
    ...(html
      ? [{ mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } }]
      : []),
  ],
});

const makeMessage = (overrides?: object) => ({
  data: {
    id: "msg1",
    threadId: "thread1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "snippet text",
    internalDate: "1704067200000",
    payload: makePayload("Hello world", "<p>Hello world</p>"),
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProfile.mockResolvedValue({ data: { emailAddress: "me@example.com" } });
  mockMessagesSend.mockResolvedValue({ data: { id: "sent1", threadId: "thread1" } });
});

describe("getMessage", () => {
  it("calls messages.get with format full", async () => {
    mockMessagesGet.mockResolvedValue(makeMessage());

    await getMessage("msg1");

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: "me",
      id: "msg1",
      format: "full",
    });
  });

  it("returns decoded message with headers", async () => {
    mockMessagesGet.mockResolvedValue(makeMessage());

    const result = await getMessage("msg1");

    expect(result.id).toBe("msg1");
    expect(result.threadId).toBe("thread1");
    expect(result.subject).toBe("Test Subject");
    expect(result.from).toBe("alice@example.com");
    expect(result.to).toBe("bob@example.com");
  });

  it("decodes base64url body text", async () => {
    mockMessagesGet.mockResolvedValue(makeMessage());

    const result = await getMessage("msg1");

    expect(result.bodyText).toBe("Hello world");
  });

  it("decodes base64url body html", async () => {
    mockMessagesGet.mockResolvedValue(makeMessage());

    const result = await getMessage("msg1");

    expect(result.bodyHtml).toBe("<p>Hello world</p>");
  });

  it("returns empty bodyHtml for plain-text only message", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        id: "msg2",
        threadId: "thread1",
        labelIds: ["INBOX"],
        snippet: "plain only",
        internalDate: "1704067200000",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "Subject", value: "Plain Only" },
            { name: "From", value: "a@b.com" },
            { name: "To", value: "c@d.com" },
            { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" },
          ],
          body: { data: Buffer.from("Just text").toString("base64url") },
        },
      },
    });

    const result = await getMessage("msg2");

    expect(result.bodyText).toBe("Just text");
    expect(result.bodyHtml).toBe("");
  });

  it("walks nested multipart parts to find text/plain", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        id: "msg3",
        threadId: "thread1",
        labelIds: ["INBOX"],
        snippet: "nested",
        internalDate: "1704067200000",
        payload: {
          mimeType: "multipart/mixed",
          headers: [
            { name: "Subject", value: "Nested" },
            { name: "From", value: "a@b.com" },
            { name: "To", value: "c@d.com" },
            { name: "Date", value: "Mon, 1 Jan 2024 10:00:00 +0000" },
          ],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                {
                  mimeType: "text/plain",
                  body: { data: Buffer.from("Nested body").toString("base64url") },
                },
              ],
            },
          ],
        },
      },
    });

    const result = await getMessage("msg3");

    expect(result.bodyText).toBe("Nested body");
  });
});

describe("getThread", () => {
  it("calls threads.get with format full", async () => {
    mockThreadsGet.mockResolvedValue({
      data: { id: "thread1", messages: [makeMessage().data] },
    });

    await getThread("thread1");

    expect(mockThreadsGet).toHaveBeenCalledWith({
      userId: "me",
      id: "thread1",
      format: "full",
    });
  });

  it("returns thread with decoded messages", async () => {
    mockThreadsGet.mockResolvedValue({
      data: { id: "thread1", messages: [makeMessage().data] },
    });

    const result = await getThread("thread1");

    expect(result.id).toBe("thread1");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe("msg1");
  });
});

describe("searchThreads", () => {
  it("calls threads.list with query and maxResults", async () => {
    mockThreadsList.mockResolvedValue({
      data: { threads: [{ id: "t1", snippet: "result", historyId: "123" }] },
    });

    await searchThreads("is:unread", 10);

    expect(mockThreadsList).toHaveBeenCalledWith({
      userId: "me",
      q: "is:unread",
      maxResults: 10,
    });
  });

  it("returns array of thread summaries with snippets", async () => {
    mockThreadsList.mockResolvedValue({
      data: {
        threads: [
          { id: "t1", snippet: "summary one", historyId: "100" },
          { id: "t2", snippet: "summary two", historyId: "101" },
        ],
      },
    });

    const result = await searchThreads("from:alice", 5);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("t1");
    expect(result[0].snippet).toBe("summary one");
  });

  it("returns empty array when no threads match", async () => {
    mockThreadsList.mockResolvedValue({ data: {} });

    const result = await searchThreads("from:nobody", 10);

    expect(result).toEqual([]);
  });
});

describe("sendMessage", () => {
  it("fetches sender profile and sets it on message", async () => {
    await sendMessage("to@example.com", "Subject", "Body");

    expect(mockGetProfile).toHaveBeenCalledWith({ userId: "me" });
    expect(mockMimeMsg.setSender).toHaveBeenCalledWith({ addr: "me@example.com" });
  });

  it("calls messages.send with base64url encoded raw", async () => {
    await sendMessage("to@example.com", "Subject", "Body");

    expect(mockMessagesSend).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        raw: expect.any(String),
      },
    });
  });

  it("sets subject and recipient on mime message", async () => {
    await sendMessage("to@example.com", "Subject", "Body");

    expect(mockMimeMsg.setSubject).toHaveBeenCalledWith("Subject");
    expect(mockMimeMsg.setRecipient).toHaveBeenCalledWith("to@example.com");
  });

  it("throws if profile has no emailAddress", async () => {
    mockGetProfile.mockResolvedValue({ data: {} });

    await expect(sendMessage("to@example.com", "Subject", "Body")).rejects.toThrow();
  });
});

describe("replyToThread", () => {
  it("fetches original message for threading headers", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: "Message-ID", value: "<original@mail.gmail.com>" },
            { name: "From", value: "alice@example.com" },
            { name: "Subject", value: "Original Subject" },
          ],
        },
      },
    });

    await replyToThread("thread1", "msg1", "Reply body");

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: "me",
      id: "msg1",
      format: "metadata",
    });
  });

  it("sets In-Reply-To header from original Message-ID", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: "Message-ID", value: "<original@mail.gmail.com>" },
            { name: "From", value: "alice@example.com" },
            { name: "Subject", value: "Original Subject" },
          ],
        },
      },
    });

    await replyToThread("thread1", "msg1", "Reply body");

    expect(mockMimeMsg.setHeader).toHaveBeenCalledWith(
      "In-Reply-To",
      "<original@mail.gmail.com>",
    );
  });

  it("sends with threadId for thread grouping", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: "Message-ID", value: "<original@mail.gmail.com>" },
            { name: "From", value: "alice@example.com" },
            { name: "Subject", value: "Original" },
          ],
        },
      },
    });

    await replyToThread("thread1", "msg1", "Reply body");

    expect(mockMessagesSend).toHaveBeenCalledWith({
      userId: "me",
      requestBody: expect.objectContaining({ threadId: "thread1" }),
    });
  });
});

describe("createDraft", () => {
  it("calls drafts.create with message raw", async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: "draft1" } });

    await createDraft("to@example.com", "Draft Subject", "Draft body");

    expect(mockDraftsCreate).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        message: expect.objectContaining({ raw: expect.any(String) }),
      },
    });
  });

  it("includes threadId when provided", async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: "draft1" } });

    await createDraft("to@example.com", "Subject", "Body", "thread1");

    expect(mockDraftsCreate).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        message: expect.objectContaining({ threadId: "thread1" }),
      },
    });
  });

  it("returns draft id", async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: "draft1" } });

    const result = await createDraft("to@example.com", "Subject", "Body");

    expect(result).toBe("draft1");
  });
});

describe("modifyLabels", () => {
  it("calls messages.modify with add and remove label ids", async () => {
    mockMessagesModify.mockResolvedValue({ data: {} });

    await modifyLabels("msg1", ["STARRED"], ["UNREAD"]);

    expect(mockMessagesModify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg1",
      requestBody: {
        addLabelIds: ["STARRED"],
        removeLabelIds: ["UNREAD"],
      },
    });
  });
});

describe("markAsRead", () => {
  it("removes UNREAD label", async () => {
    mockMessagesModify.mockResolvedValue({ data: {} });

    await markAsRead("msg1");

    expect(mockMessagesModify).toHaveBeenCalledWith({
      userId: "me",
      id: "msg1",
      requestBody: {
        addLabelIds: [],
        removeLabelIds: ["UNREAD"],
      },
    });
  });
});

describe("trashThread", () => {
  it("calls threads.trash", async () => {
    mockThreadsTrash.mockResolvedValue({ data: {} });

    await trashThread("thread1");

    expect(mockThreadsTrash).toHaveBeenCalledWith({
      userId: "me",
      id: "thread1",
    });
  });
});

describe("listLabels", () => {
  it("calls labels.list and returns label array", async () => {
    mockLabelsList.mockResolvedValue({
      data: {
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "UNREAD", name: "UNREAD", type: "system" },
        ],
      },
    });

    const result = await listLabels();

    expect(mockLabelsList).toHaveBeenCalledWith({ userId: "me" });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("INBOX");
  });

  it("returns empty array when no labels", async () => {
    mockLabelsList.mockResolvedValue({ data: {} });

    const result = await listLabels();

    expect(result).toEqual([]);
  });
});

describe("sendMessage attachments", () => {
  it("calls addAttachment for each attachment", async () => {
    const attachments: EmailAttachment[] = [
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        data: Buffer.from("pdf content"),
      },
    ];

    await sendMessage("to@example.com", "Subject", "Body", { attachments });

    expect(mockMimeMsg.addAttachment).toHaveBeenCalledWith({
      filename: "report.pdf",
      contentType: "application/pdf",
      data: expect.any(String),
    });
  });

  it("passes attachment data as base64 string", async () => {
    const content = "hello attachment";
    const attachments: EmailAttachment[] = [
      { filename: "note.txt", contentType: "text/plain", data: Buffer.from(content) },
    ];

    await sendMessage("to@example.com", "Subject", "Body", { attachments });

    const call = mockMimeMsg.addAttachment.mock.calls[0][0];
    expect(call.data).toBe(Buffer.from(content).toString("base64"));
  });

  it("does not call addAttachment when no attachments provided", async () => {
    await sendMessage("to@example.com", "Subject", "Body");

    expect(mockMimeMsg.addAttachment).not.toHaveBeenCalled();
  });
});

describe("createDraft attachments", () => {
  it("calls addAttachment when attachments provided", async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: "draft1" } });
    const attachments: EmailAttachment[] = [
      { filename: "doc.pdf", contentType: "application/pdf", data: Buffer.from("data") },
    ];

    await createDraft("to@example.com", "Subject", "Body", undefined, { attachments });

    expect(mockMimeMsg.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "doc.pdf" }),
    );
  });
});

describe("uses asEncoded for Gmail API raw field", () => {
  it("calls asEncoded() to produce the raw field for sendMessage", async () => {
    await sendMessage("to@example.com", "Subject", "Body");

    expect(mockMimeMsg.asEncoded).toHaveBeenCalled();
  });

  it("calls asEncoded() for replyToThread", async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        payload: {
          headers: [
            { name: "Message-ID", value: "<id@mail.gmail.com>" },
            { name: "From", value: "alice@example.com" },
            { name: "Subject", value: "Subject" },
          ],
        },
      },
    });

    await replyToThread("thread1", "msg1", "body");

    expect(mockMimeMsg.asEncoded).toHaveBeenCalled();
  });

  it("calls asEncoded() for createDraft", async () => {
    mockDraftsCreate.mockResolvedValue({ data: { id: "draft1" } });

    await createDraft("to@example.com", "Subject", "Body");

    expect(mockMimeMsg.asEncoded).toHaveBeenCalled();
  });
});
