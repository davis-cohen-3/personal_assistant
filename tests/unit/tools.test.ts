import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListBuckets,
  mockCreateBucket,
  mockUpdateBucket,
  mockDeleteBucket,
  mockAssignThreadsBatch,
  mockMarkAllForRebucket,
  mockCountUnbucketedThreads,
} = vi.hoisted(() => ({
  mockListBuckets: vi.fn(),
  mockCreateBucket: vi.fn(),
  mockUpdateBucket: vi.fn(),
  mockDeleteBucket: vi.fn(),
  mockAssignThreadsBatch: vi.fn(),
  mockMarkAllForRebucket: vi.fn(),
  mockCountUnbucketedThreads: vi.fn(),
}));

const {
  mockEmailSyncInbox,
  mockEmailSearch,
  mockEmailGetThread,
  mockEmailGetUnbucketedThreads,
  mockEmailSendMessage,
  mockEmailReplyToThread,
  mockEmailCreateDraft,
  mockEmailTrashThread,
  mockEmailMarkAsRead,
} = vi.hoisted(() => ({
  mockEmailSyncInbox: vi.fn(),
  mockEmailSearch: vi.fn(),
  mockEmailGetThread: vi.fn(),
  mockEmailGetUnbucketedThreads: vi.fn(),
  mockEmailSendMessage: vi.fn(),
  mockEmailReplyToThread: vi.fn(),
  mockEmailCreateDraft: vi.fn(),
  mockEmailTrashThread: vi.fn(),
  mockEmailMarkAsRead: vi.fn(),
}));

const {
  mockCalendarListEvents,
  mockCalendarGetEvent,
  mockCalendarCreateEvent,
  mockCalendarUpdateEvent,
  mockCalendarDeleteEvent,
  mockCalendarCheckFreeBusy,
} = vi.hoisted(() => ({
  mockCalendarListEvents: vi.fn(),
  mockCalendarGetEvent: vi.fn(),
  mockCalendarCreateEvent: vi.fn(),
  mockCalendarUpdateEvent: vi.fn(),
  mockCalendarDeleteEvent: vi.fn(),
  mockCalendarCheckFreeBusy: vi.fn(),
}));

const {
  mockDriveSearchFiles,
  mockDriveListRecentFiles,
  mockDriveReadDocument,
  mockDriveGetFileMetadata,
} = vi.hoisted(() => ({
  mockDriveSearchFiles: vi.fn(),
  mockDriveListRecentFiles: vi.fn(),
  mockDriveReadDocument: vi.fn(),
  mockDriveGetFileMetadata: vi.fn(),
}));

vi.mock("../../src/server/db/queries.js", () => ({
  listBuckets: mockListBuckets,
  createBucket: mockCreateBucket,
  updateBucket: mockUpdateBucket,
  deleteBucket: mockDeleteBucket,
  assignThreadsBatch: mockAssignThreadsBatch,
  markAllForRebucket: mockMarkAllForRebucket,
  countUnbucketedThreads: mockCountUnbucketedThreads,
}));

vi.mock("../../src/server/email.js", () => ({
  syncInbox: mockEmailSyncInbox,
  search: mockEmailSearch,
  getThread: mockEmailGetThread,
  getUnbucketedThreads: mockEmailGetUnbucketedThreads,
  sendMessage: mockEmailSendMessage,
  replyToThread: mockEmailReplyToThread,
  createDraft: mockEmailCreateDraft,
  trashThread: mockEmailTrashThread,
  markAsRead: mockEmailMarkAsRead,
}));

vi.mock("../../src/server/google/calendar.js", () => ({
  listEvents: mockCalendarListEvents,
  getEvent: mockCalendarGetEvent,
  createEvent: mockCalendarCreateEvent,
  updateEvent: mockCalendarUpdateEvent,
  deleteEvent: mockCalendarDeleteEvent,
  checkFreeBusy: mockCalendarCheckFreeBusy,
}));

vi.mock("../../src/server/google/drive.js", () => ({
  searchFiles: mockDriveSearchFiles,
  listRecentFiles: mockDriveListRecentFiles,
  readDocument: mockDriveReadDocument,
  getFileMetadata: mockDriveGetFileMetadata,
}));

import { handlers } from "../../src/server/tools.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buckets tool", () => {
  describe("list action", () => {
    it("calls queries.listBuckets() and returns JSON", async () => {
      const buckets = [{ id: "b1", name: "Inbox", description: "Main inbox" }];
      mockListBuckets.mockResolvedValue(buckets);

      const result = await handlers.buckets({ action: "list" });

      expect(mockListBuckets).toHaveBeenCalledOnce();
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(buckets);
    });
  });

  describe("create action", () => {
    it("calls createBucket and markAllForRebucket, returns rebucket_required: true", async () => {
      const created = { id: "b2", name: "Newsletters", description: "Newsletter emails" };
      mockCreateBucket.mockResolvedValue(created);
      mockMarkAllForRebucket.mockResolvedValue(undefined);

      const result = await handlers.buckets({
        action: "create",
        name: "Newsletters",
        description: "Newsletter emails",
      });

      expect(mockCreateBucket).toHaveBeenCalledWith("Newsletters", "Newsletter emails");
      expect(mockMarkAllForRebucket).toHaveBeenCalledOnce();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.rebucket_required).toBe(true);
      expect(parsed.id).toBe("b2");
      expect(parsed.name).toBe("Newsletters");
    });
  });

  describe("update action", () => {
    it("calls queries.updateBucket with id and params", async () => {
      const updated = { id: "b1", name: "Updated Name", description: "Updated desc" };
      mockUpdateBucket.mockResolvedValue(updated);

      const result = await handlers.buckets({
        action: "update",
        id: "b1",
        name: "Updated Name",
        description: "Updated desc",
      });

      expect(mockUpdateBucket).toHaveBeenCalledWith(
        "b1",
        expect.objectContaining({ name: "Updated Name", description: "Updated desc" }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("b1");
    });
  });

  describe("delete action", () => {
    it("calls queries.deleteBucket with id and returns ok: true", async () => {
      mockDeleteBucket.mockResolvedValue(undefined);

      const result = await handlers.buckets({ action: "delete", id: "b1" });

      expect(mockDeleteBucket).toHaveBeenCalledWith("b1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
    });
  });

  describe("assign action", () => {
    it("maps snake_case fields to camelCase and calls assignThreadsBatch", async () => {
      mockAssignThreadsBatch.mockResolvedValue([{ gmail_thread_id: "t1", bucket_id: "b1" }]);
      mockCountUnbucketedThreads.mockResolvedValue(5);

      const assignments = [
        { gmail_thread_id: "t1", bucket_id: "b1", subject: "Hello", snippet: "World" },
        { gmail_thread_id: "t2", bucket_id: "b2" },
      ];

      await handlers.buckets({ action: "assign", assignments });

      expect(mockAssignThreadsBatch).toHaveBeenCalledWith([
        { gmailThreadId: "t1", bucketId: "b1", subject: "Hello", snippet: "World" },
        { gmailThreadId: "t2", bucketId: "b2", subject: undefined, snippet: undefined },
      ]);
    });

    it("returns assigned count and remaining unbucketed", async () => {
      mockAssignThreadsBatch.mockResolvedValue([{}, {}]);
      mockCountUnbucketedThreads.mockResolvedValue(10);

      const result = await handlers.buckets({
        action: "assign",
        assignments: [
          { gmail_thread_id: "t1", bucket_id: "b1" },
          { gmail_thread_id: "t2", bucket_id: "b2" },
        ],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.assigned).toBe(2);
      expect(parsed.remaining).toBe(10);
    });

    it("returns error dict when assignments is missing", async () => {
      const result = await handlers.buckets({ action: "assign" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/assignments is required/);
    });

    it("returns error dict when assignments has 26 items (exceeds BATCH_SIZE)", async () => {
      const assignments = Array.from({ length: 26 }, (_, i) => ({
        gmail_thread_id: `t${i}`,
        bucket_id: "b1",
      }));

      const result = await handlers.buckets({ action: "assign", assignments });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/max 25/);
    });
  });
});

describe("sync_email tool", () => {
  describe("sync action", () => {
    it("calls email.syncInbox() and returns JSON", async () => {
      mockEmailSyncInbox.mockResolvedValue({ new: 3, updated: 2 });

      const result = await handlers.sync_email({ action: "sync" });

      expect(mockEmailSyncInbox).toHaveBeenCalledWith(undefined);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ new: 3, updated: 2 });
    });

    it("passes max_results to syncInbox when provided", async () => {
      mockEmailSyncInbox.mockResolvedValue({ new: 0, updated: 0 });

      await handlers.sync_email({ action: "sync", max_results: 50 });

      expect(mockEmailSyncInbox).toHaveBeenCalledWith(50);
    });
  });

  describe("search action", () => {
    it("calls email.search with query and max_results", async () => {
      const threads = [{ gmail_thread_id: "t1" }];
      mockEmailSearch.mockResolvedValue(threads);

      const result = await handlers.sync_email({
        action: "search",
        query: "from:alice@example.com",
        max_results: 10,
      });

      expect(mockEmailSearch).toHaveBeenCalledWith("from:alice@example.com", 10);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(threads);
    });
  });

  describe("get_thread action", () => {
    it("calls email.getThread with thread_id", async () => {
      const thread = { gmail_thread_id: "t1", messages: [] };
      mockEmailGetThread.mockResolvedValue(thread);

      const result = await handlers.sync_email({ action: "get_thread", thread_id: "t1" });

      expect(mockEmailGetThread).toHaveBeenCalledWith("t1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.gmail_thread_id).toBe("t1");
    });
  });

  describe("get_unbucketed action", () => {
    it("calls email.getUnbucketedThreads and returns JSON", async () => {
      mockEmailGetUnbucketedThreads.mockResolvedValue({ unbucketed: 5, threads: [] });

      const result = await handlers.sync_email({ action: "get_unbucketed" });

      expect(mockEmailGetUnbucketedThreads).toHaveBeenCalledOnce();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.unbucketed).toBe(5);
    });
  });
});

describe("action_email tool", () => {
  describe("send action", () => {
    it("calls email.sendMessage with to, subject, body, and cc", async () => {
      mockEmailSendMessage.mockResolvedValue({ id: "msg-1" });

      const result = await handlers.action_email({
        action: "send",
        to: "bob@example.com",
        subject: "Hello",
        body: "Hi Bob",
        cc: ["cc@example.com"],
      });

      expect(mockEmailSendMessage).toHaveBeenCalledWith("bob@example.com", "Hello", "Hi Bob", {
        cc: ["cc@example.com"],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("msg-1");
    });
  });

  describe("reply action", () => {
    it("calls email.replyToThread with thread_id, message_id, body", async () => {
      mockEmailReplyToThread.mockResolvedValue({ id: "msg-2" });

      const result = await handlers.action_email({
        action: "reply",
        thread_id: "t1",
        message_id: "m1",
        body: "Thanks!",
      });

      expect(mockEmailReplyToThread).toHaveBeenCalledWith("t1", "m1", "Thanks!");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("msg-2");
    });
  });

  describe("draft action", () => {
    it("calls email.createDraft with to, subject, body, and thread_id", async () => {
      mockEmailCreateDraft.mockResolvedValue("draft-1");

      const result = await handlers.action_email({
        action: "draft",
        to: "bob@example.com",
        subject: "Draft subject",
        body: "Draft body",
        thread_id: "t1",
      });

      expect(mockEmailCreateDraft).toHaveBeenCalledWith(
        "bob@example.com",
        "Draft subject",
        "Draft body",
        "t1",
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toBe("draft-1");
    });
  });

  describe("trash action", () => {
    it("calls email.trashThread with thread_id and returns ok: true", async () => {
      mockEmailTrashThread.mockResolvedValue(undefined);

      const result = await handlers.action_email({ action: "trash", thread_id: "t1" });

      expect(mockEmailTrashThread).toHaveBeenCalledWith("t1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
    });
  });

  describe("mark_read action", () => {
    it("calls email.markAsRead with message_id and returns ok: true", async () => {
      mockEmailMarkAsRead.mockResolvedValue(undefined);

      const result = await handlers.action_email({ action: "mark_read", message_id: "m1" });

      expect(mockEmailMarkAsRead).toHaveBeenCalledWith("m1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
    });
  });
});

describe("calendar tool", () => {
  describe("list action", () => {
    it("calls calendar.listEvents with time_min, time_max, and query option", async () => {
      const events = [{ id: "event-1", summary: "Meeting" }];
      mockCalendarListEvents.mockResolvedValue(events);

      const result = await handlers.calendar({
        action: "list",
        time_min: "2024-01-01T00:00:00Z",
        time_max: "2024-01-31T23:59:59Z",
        query: "team sync",
      });

      expect(mockCalendarListEvents).toHaveBeenCalledWith(
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        { q: "team sync" },
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].id).toBe("event-1");
    });
  });

  describe("create action", () => {
    it("calls calendar.createEvent with event fields", async () => {
      const event = { id: "evt-new", summary: "Stand-up" };
      mockCalendarCreateEvent.mockResolvedValue(event);

      const result = await handlers.calendar({
        action: "create",
        summary: "Stand-up",
        description: "Daily stand-up",
        location: "Conference room",
        start: "2024-01-15T09:00:00Z",
        end: "2024-01-15T09:30:00Z",
        attendees: ["alice@example.com"],
      });

      expect(mockCalendarCreateEvent).toHaveBeenCalledWith({
        summary: "Stand-up",
        description: "Daily stand-up",
        location: "Conference room",
        start: "2024-01-15T09:00:00Z",
        end: "2024-01-15T09:30:00Z",
        attendees: ["alice@example.com"],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("evt-new");
    });
  });

  describe("free_busy action", () => {
    it("calls calendar.checkFreeBusy with time_min and time_max", async () => {
      const freeBusy = { primary: { busy: [] } };
      mockCalendarCheckFreeBusy.mockResolvedValue(freeBusy);

      const result = await handlers.calendar({
        action: "free_busy",
        time_min: "2024-01-15T00:00:00Z",
        time_max: "2024-01-15T23:59:59Z",
      });

      expect(mockCalendarCheckFreeBusy).toHaveBeenCalledWith(
        "2024-01-15T00:00:00Z",
        "2024-01-15T23:59:59Z",
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(freeBusy);
    });
  });
});

describe("drive tool", () => {
  describe("search action", () => {
    it("calls drive.searchFiles with query and max_results option", async () => {
      const files = [{ id: "file-1", name: "Document.gdoc" }];
      mockDriveSearchFiles.mockResolvedValue(files);

      const result = await handlers.drive({
        action: "search",
        query: "project proposal",
        max_results: 10,
      });

      expect(mockDriveSearchFiles).toHaveBeenCalledWith("project proposal", { maxResults: 10 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].id).toBe("file-1");
    });
  });

  describe("read action", () => {
    it("calls drive.readDocument with file_id", async () => {
      mockDriveReadDocument.mockResolvedValue("Document content here");

      const result = await handlers.drive({ action: "read", file_id: "file-1" });

      expect(mockDriveReadDocument).toHaveBeenCalledWith("file-1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toBe("Document content here");
    });
  });
});
