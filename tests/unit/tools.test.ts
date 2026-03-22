import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "user-1";

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

const { mockAuthClient } = vi.hoisted(() => ({
  mockAuthClient: { setCredentials: vi.fn() },
}));
vi.mock("../../src/server/google/auth.js", () => ({
  withUserTokens: vi.fn().mockResolvedValue(mockAuthClient),
}));

import { withUserTokens } from "../../src/server/google/auth.js";
import { handlers } from "../../src/server/tools.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(withUserTokens).mockResolvedValue(mockAuthClient);
});

describe("buckets tool", () => {
  describe("list action", () => {
    it("calls queries.listBuckets() and returns JSON", async () => {
      const buckets = [{ id: "b1", name: "Inbox", description: "Main inbox" }];
      mockListBuckets.mockResolvedValue(buckets);

      const result = await handlers.buckets(TEST_USER_ID, { action: "list" });

      expect(mockListBuckets).toHaveBeenCalledWith(TEST_USER_ID);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(buckets);
    });
  });

  describe("create action", () => {
    it("calls createBucket and markAllForRebucket, returns rebucket_required: true", async () => {
      const created = { id: "b2", name: "Newsletters", description: "Newsletter emails" };
      mockCreateBucket.mockResolvedValue(created);
      mockMarkAllForRebucket.mockResolvedValue(undefined);

      const result = await handlers.buckets(TEST_USER_ID, {
        action: "create",
        name: "Newsletters",
        description: "Newsletter emails",
      });

      expect(mockCreateBucket).toHaveBeenCalledWith(TEST_USER_ID, "Newsletters", "Newsletter emails");
      expect(mockMarkAllForRebucket).toHaveBeenCalledWith(TEST_USER_ID);

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

      const result = await handlers.buckets(TEST_USER_ID, {
        action: "update",
        id: "b1",
        name: "Updated Name",
        description: "Updated desc",
      });

      expect(mockUpdateBucket).toHaveBeenCalledWith(
        TEST_USER_ID,
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

      const result = await handlers.buckets(TEST_USER_ID, { action: "delete", id: "b1" });

      expect(mockDeleteBucket).toHaveBeenCalledWith(TEST_USER_ID, "b1");
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

      await handlers.buckets(TEST_USER_ID, { action: "assign", assignments });

      expect(mockAssignThreadsBatch).toHaveBeenCalledWith(TEST_USER_ID, [
        { gmailThreadId: "t1", bucketId: "b1", subject: "Hello", snippet: "World" },
        { gmailThreadId: "t2", bucketId: "b2", subject: undefined, snippet: undefined },
      ]);
    });

    it("returns assigned count and remaining unbucketed", async () => {
      mockAssignThreadsBatch.mockResolvedValue([{}, {}]);
      mockCountUnbucketedThreads.mockResolvedValue(10);

      const result = await handlers.buckets(TEST_USER_ID, {
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
      const result = await handlers.buckets(TEST_USER_ID, { action: "assign" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/assignments is required/);
    });

    it("returns error dict when assignments has 26 items (exceeds BATCH_SIZE)", async () => {
      const assignments = Array.from({ length: 26 }, (_, i) => ({
        gmail_thread_id: `t${i}`,
        bucket_id: "b1",
      }));

      const result = await handlers.buckets(TEST_USER_ID, { action: "assign", assignments });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/max 25/);
    });
  });
});

describe("sync_email tool", () => {
  describe("sync action", () => {
    it("calls email.syncInbox() and returns JSON", async () => {
      mockEmailSyncInbox.mockResolvedValue({ new: 3, updated: 2 });

      const result = await handlers.sync_email(TEST_USER_ID, { action: "sync" });

      expect(mockEmailSyncInbox).toHaveBeenCalledWith(TEST_USER_ID, undefined);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ new: 3, updated: 2 });
    });

    it("passes max_results to syncInbox when provided", async () => {
      mockEmailSyncInbox.mockResolvedValue({ new: 0, updated: 0 });

      await handlers.sync_email(TEST_USER_ID, { action: "sync", max_results: 50 });

      expect(mockEmailSyncInbox).toHaveBeenCalledWith(TEST_USER_ID, 50);
    });
  });

  describe("search action", () => {
    it("calls email.search with query and max_results", async () => {
      const threads = [{ gmail_thread_id: "t1" }];
      mockEmailSearch.mockResolvedValue(threads);

      const result = await handlers.sync_email(TEST_USER_ID, {
        action: "search",
        query: "from:alice@example.com",
        max_results: 10,
      });

      expect(mockEmailSearch).toHaveBeenCalledWith(TEST_USER_ID, "from:alice@example.com", 10);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(threads);
    });
  });

  describe("get_thread action", () => {
    it("calls email.getThread with thread_id", async () => {
      const thread = { gmail_thread_id: "t1", messages: [] };
      mockEmailGetThread.mockResolvedValue(thread);

      const result = await handlers.sync_email(TEST_USER_ID, { action: "get_thread", thread_id: "t1" });

      expect(mockEmailGetThread).toHaveBeenCalledWith(TEST_USER_ID, "t1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.gmail_thread_id).toBe("t1");
    });
  });

  describe("get_unbucketed action", () => {
    it("calls email.getUnbucketedThreads and returns JSON", async () => {
      mockEmailGetUnbucketedThreads.mockResolvedValue({ unbucketed: 5, threads: [] });

      const result = await handlers.sync_email(TEST_USER_ID, { action: "get_unbucketed" });

      expect(mockEmailGetUnbucketedThreads).toHaveBeenCalledWith(TEST_USER_ID);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.unbucketed).toBe(5);
    });
  });
});

describe("action_email tool", () => {
  describe("send action", () => {
    it("calls email.sendMessage with to, subject, body, and cc", async () => {
      mockEmailSendMessage.mockResolvedValue(undefined);

      const result = await handlers.action_email(TEST_USER_ID, {
        action: "send",
        to: "bob@example.com",
        subject: "Hello",
        body: "Hi Bob",
        cc: ["cc@example.com"],
      });

      expect(mockEmailSendMessage).toHaveBeenCalledWith(TEST_USER_ID, "bob@example.com", "Hello", "Hi Bob", {
        cc: ["cc@example.com"],
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ ok: true });
    });
  });

  describe("reply action", () => {
    it("calls email.replyToThread with thread_id, message_id, body", async () => {
      mockEmailReplyToThread.mockResolvedValue(undefined);

      const result = await handlers.action_email(TEST_USER_ID, {
        action: "reply",
        thread_id: "t1",
        message_id: "m1",
        body: "Thanks!",
      });

      expect(mockEmailReplyToThread).toHaveBeenCalledWith(TEST_USER_ID, "t1", "m1", "Thanks!");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ ok: true });
    });
  });

  describe("draft action", () => {
    it("calls email.createDraft with to, subject, body, and thread_id", async () => {
      mockEmailCreateDraft.mockResolvedValue("draft-1");

      const result = await handlers.action_email(TEST_USER_ID, {
        action: "draft",
        to: "bob@example.com",
        subject: "Draft subject",
        body: "Draft body",
        thread_id: "t1",
      });

      expect(mockEmailCreateDraft).toHaveBeenCalledWith(
        TEST_USER_ID,
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

      const result = await handlers.action_email(TEST_USER_ID, { action: "trash", thread_id: "t1" });

      expect(mockEmailTrashThread).toHaveBeenCalledWith(TEST_USER_ID, "t1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
    });
  });

  describe("mark_read action", () => {
    it("calls email.markAsRead with message_id and returns ok: true", async () => {
      mockEmailMarkAsRead.mockResolvedValue(undefined);

      const result = await handlers.action_email(TEST_USER_ID, { action: "mark_read", message_id: "m1" });

      expect(mockEmailMarkAsRead).toHaveBeenCalledWith(TEST_USER_ID, "m1");
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

      const result = await handlers.calendar(TEST_USER_ID, {
        action: "list",
        time_min: "2024-01-01T00:00:00Z",
        time_max: "2024-01-31T23:59:59Z",
        query: "team sync",
      });

      expect(mockCalendarListEvents).toHaveBeenCalledWith(
        mockAuthClient,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        { q: "team sync" },
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].id).toBe("event-1");
    });
  });

  describe("get action", () => {
    it("calls calendar.getEvent with event_id", async () => {
      const event = { id: "evt-1", summary: "Stand-up" };
      mockCalendarGetEvent.mockResolvedValue(event);

      const result = await handlers.calendar(TEST_USER_ID, { action: "get", event_id: "evt-1" });

      expect(mockCalendarGetEvent).toHaveBeenCalledWith(mockAuthClient, "evt-1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("evt-1");
    });

    it("returns error dict when event_id is missing", async () => {
      const result = await handlers.calendar(TEST_USER_ID, { action: "get" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/event_id is required/);
    });
  });

  describe("create action", () => {
    it("calls calendar.createEvent with event fields", async () => {
      const event = { id: "evt-new", summary: "Stand-up" };
      mockCalendarCreateEvent.mockResolvedValue(event);

      const result = await handlers.calendar(TEST_USER_ID, {
        action: "create",
        summary: "Stand-up",
        description: "Daily stand-up",
        location: "Conference room",
        start: "2024-01-15T09:00:00Z",
        end: "2024-01-15T09:30:00Z",
        attendees: ["alice@example.com"],
      });

      expect(mockCalendarCreateEvent).toHaveBeenCalledWith(mockAuthClient, {
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

  describe("update action", () => {
    it("calls calendar.updateEvent with event_id and fields", async () => {
      const updated = { id: "evt-1", summary: "Updated Stand-up" };
      mockCalendarUpdateEvent.mockResolvedValue(updated);

      const result = await handlers.calendar(TEST_USER_ID, {
        action: "update",
        event_id: "evt-1",
        summary: "Updated Stand-up",
        location: "Room B",
      });

      expect(mockCalendarUpdateEvent).toHaveBeenCalledWith(mockAuthClient, "evt-1", expect.objectContaining({
        summary: "Updated Stand-up",
        location: "Room B",
      }));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe("evt-1");
    });

    it("returns error dict when event_id is missing", async () => {
      const result = await handlers.calendar(TEST_USER_ID, { action: "update", summary: "No ID" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/event_id is required/);
    });
  });

  describe("delete action", () => {
    it("calls calendar.deleteEvent with event_id and returns ok: true", async () => {
      mockCalendarDeleteEvent.mockResolvedValue(undefined);

      const result = await handlers.calendar(TEST_USER_ID, { action: "delete", event_id: "evt-1" });

      expect(mockCalendarDeleteEvent).toHaveBeenCalledWith(mockAuthClient, "evt-1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.ok).toBe(true);
    });

    it("returns error dict when event_id is missing", async () => {
      const result = await handlers.calendar(TEST_USER_ID, { action: "delete" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/event_id is required/);
    });
  });

  describe("free_busy action", () => {
    it("calls calendar.checkFreeBusy with time_min and time_max", async () => {
      const freeBusy = { primary: { busy: [] } };
      mockCalendarCheckFreeBusy.mockResolvedValue(freeBusy);

      const result = await handlers.calendar(TEST_USER_ID, {
        action: "free_busy",
        time_min: "2024-01-15T00:00:00Z",
        time_max: "2024-01-15T23:59:59Z",
      });

      expect(mockCalendarCheckFreeBusy).toHaveBeenCalledWith(
        mockAuthClient,
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

      const result = await handlers.drive(TEST_USER_ID, {
        action: "search",
        query: "project proposal",
        max_results: 10,
      });

      expect(mockDriveSearchFiles).toHaveBeenCalledWith(mockAuthClient, "project proposal", { maxResults: 10 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].id).toBe("file-1");
    });
  });

  describe("list_recent action", () => {
    it("calls drive.listRecentFiles with max_results", async () => {
      const files = [{ id: "file-1", name: "Recent.gdoc" }];
      mockDriveListRecentFiles.mockResolvedValue(files);

      const result = await handlers.drive(TEST_USER_ID, { action: "list_recent", max_results: 5 });

      expect(mockDriveListRecentFiles).toHaveBeenCalledWith(mockAuthClient, 5);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].id).toBe("file-1");
    });
  });

  describe("metadata action", () => {
    it("calls drive.getFileMetadata with file_id", async () => {
      const meta = { id: "file-1", name: "Doc.gdoc", mimeType: "application/vnd.google-apps.document" };
      mockDriveGetFileMetadata.mockResolvedValue(meta);

      const result = await handlers.drive(TEST_USER_ID, { action: "metadata", file_id: "file-1" });

      expect(mockDriveGetFileMetadata).toHaveBeenCalledWith(mockAuthClient, "file-1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.name).toBe("Doc.gdoc");
    });

    it("returns error dict when file_id is missing", async () => {
      const result = await handlers.drive(TEST_USER_ID, { action: "metadata" });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/file_id is required/);
    });
  });

  describe("read action", () => {
    it("calls drive.readDocument with file_id", async () => {
      mockDriveReadDocument.mockResolvedValue("Document content here");

      const result = await handlers.drive(TEST_USER_ID, { action: "read", file_id: "file-1" });

      expect(mockDriveReadDocument).toHaveBeenCalledWith(mockAuthClient, "file-1");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toBe("Document content here");
    });
  });
});
