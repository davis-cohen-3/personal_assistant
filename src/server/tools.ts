import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as queries from "./db/queries.js";
import * as email from "./email.js";
import * as calendar from "./google/calendar.js";
import * as drive from "./google/drive.js";

const BATCH_SIZE = 25;

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export const handlers = {
  buckets: async (params: {
    action: "list" | "create" | "update" | "delete" | "assign";
    id?: string;
    name?: string;
    description?: string;
    sort_order?: number;
    assignments?: Array<{
      gmail_thread_id: string;
      bucket_id: string;
      subject?: string;
      snippet?: string;
    }>;
  }) => {
    console.info("tool:buckets", {
      action: params.action,
      id: params.id,
      name: params.name,
      assignmentCount: params.assignments?.length,
    });
    switch (params.action) {
      case "list": {
        const result = await queries.listBuckets();
        console.info("tool:buckets complete", { action: "list", count: result.length });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "create": {
        if (!params.name) return err("name is required for create action");
        if (!params.description) return err("description is required for create action");
        const result = await queries.createBucket(params.name, params.description);
        await queries.markAllForRebucket();
        console.info("tool:buckets complete", {
          action: "create",
          id: result.id,
          name: result.name,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...result,
                rebucket_required: true,
                message: `Bucket "${params.name}" created. All threads need re-evaluation.`,
              }),
            },
          ],
        };
      }
      case "update": {
        if (!params.id) return err("id is required for update action");
        const result = await queries.updateBucket(params.id, params);
        console.info("tool:buckets complete", {
          action: "update",
          id: result.id,
          name: result.name,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "delete": {
        if (!params.id) return err("id is required for delete action");
        await queries.deleteBucket(params.id);
        console.info("tool:buckets complete", { action: "delete", id: params.id });
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
      }
      case "assign": {
        if (!params.assignments) return err(`assignments is required, max ${BATCH_SIZE} per batch`);
        if (params.assignments.length > BATCH_SIZE)
          return err(`max ${BATCH_SIZE} assignments per batch`);
        const result = await queries.assignThreadsBatch(
          params.assignments.map((a) => ({
            gmailThreadId: a.gmail_thread_id,
            bucketId: a.bucket_id,
            subject: a.subject,
            snippet: a.snippet,
          })),
        );
        const remaining = await queries.countUnbucketedThreads();
        console.info("tool:buckets complete", {
          action: "assign",
          assigned: result.length,
          remaining,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ assigned: result.length, remaining }),
            },
          ],
        };
      }
    }
  },

  sync_email: async (params: {
    action: "sync" | "search" | "get_thread" | "get_unbucketed";
    query?: string;
    max_results?: number;
    thread_id?: string;
  }) => {
    console.info("tool:sync_email", {
      action: params.action,
      query: params.query,
      max_results: params.max_results,
      thread_id: params.thread_id,
    });
    switch (params.action) {
      case "sync": {
        const result = await email.syncInbox(params.max_results);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "search": {
        if (!params.query) return err("query is required for search action");
        const result = await email.search(params.query, params.max_results);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "get_thread": {
        if (!params.thread_id) return err("thread_id is required for get_thread action");
        const result = await email.getThread(params.thread_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "get_unbucketed": {
        const result = await email.getUnbucketedThreads();
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    }
  },

  action_email: async (params: {
    action: "send" | "reply" | "draft" | "trash" | "mark_read";
    to?: string;
    cc?: string[];
    subject?: string;
    body?: string;
    thread_id?: string;
    message_id?: string;
  }) => {
    console.info("tool:action_email", {
      action: params.action,
      to: params.to,
      subject: params.subject,
      thread_id: params.thread_id,
    });
    switch (params.action) {
      case "send": {
        if (!params.to) return err("to is required for send action");
        if (!params.subject) return err("subject is required for send action");
        if (!params.body) return err("body is required for send action");
        const result = await email.sendMessage(params.to, params.subject, params.body, {
          cc: params.cc,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "reply": {
        if (!params.thread_id) return err("thread_id is required for reply action");
        if (!params.message_id) return err("message_id is required for reply action");
        if (!params.body) return err("body is required for reply action");
        const result = await email.replyToThread(params.thread_id, params.message_id, params.body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "draft": {
        if (!params.to) return err("to is required for draft action");
        if (!params.subject) return err("subject is required for draft action");
        if (!params.body) return err("body is required for draft action");
        const result = await email.createDraft(
          params.to,
          params.subject,
          params.body,
          params.thread_id,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "trash": {
        if (!params.thread_id) return err("thread_id is required for trash action");
        await email.trashThread(params.thread_id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
      }
      case "mark_read": {
        if (!params.message_id) return err("message_id is required for mark_read action");
        await email.markAsRead(params.message_id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
      }
    }
  },

  calendar: async (params: {
    action: "list" | "get" | "create" | "update" | "delete" | "free_busy";
    time_min?: string;
    time_max?: string;
    event_id?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    attendees?: string[];
    query?: string;
  }) => {
    console.info("tool:calendar", {
      action: params.action,
      event_id: params.event_id,
      summary: params.summary,
      time_min: params.time_min,
      time_max: params.time_max,
    });
    switch (params.action) {
      case "list": {
        if (!params.time_min) return err("time_min is required for list action");
        if (!params.time_max) return err("time_max is required for list action");
        const result = await calendar.listEvents(params.time_min, params.time_max, {
          q: params.query,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "get": {
        if (!params.event_id) return err("event_id is required for get action");
        const result = await calendar.getEvent(params.event_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "create": {
        if (!params.summary) return err("summary is required for create action");
        if (!params.start) return err("start is required for create action");
        if (!params.end) return err("end is required for create action");
        const result = await calendar.createEvent({
          summary: params.summary,
          description: params.description,
          location: params.location,
          start: params.start,
          end: params.end,
          attendees: params.attendees,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "update": {
        if (!params.event_id) return err("event_id is required for update action");
        const result = await calendar.updateEvent(params.event_id, {
          summary: params.summary,
          description: params.description,
          location: params.location,
          start: params.start,
          end: params.end,
          attendees: params.attendees,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "delete": {
        if (!params.event_id) return err("event_id is required for delete action");
        await calendar.deleteEvent(params.event_id);
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
      }
      case "free_busy": {
        if (!params.time_min) return err("time_min is required for free_busy action");
        if (!params.time_max) return err("time_max is required for free_busy action");
        const result = await calendar.checkFreeBusy(params.time_min, params.time_max);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    }
  },

  drive: async (params: {
    action: "search" | "list_recent" | "read" | "metadata";
    query?: string;
    file_id?: string;
    max_results?: number;
  }) => {
    console.info("tool:drive", {
      action: params.action,
      query: params.query,
      file_id: params.file_id,
    });
    switch (params.action) {
      case "search": {
        if (!params.query) return err("query is required for search action");
        const result = await drive.searchFiles(params.query, { maxResults: params.max_results });
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "list_recent": {
        const result = await drive.listRecentFiles(params.max_results);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "read": {
        if (!params.file_id) return err("file_id is required for read action");
        const result = await drive.readDocument(params.file_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      case "metadata": {
        if (!params.file_id) return err("file_id is required for metadata action");
        const result = await drive.getFileMetadata(params.file_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
    }
  },
};

export function createCustomMcpServer() {
  return createSdkMcpServer({
    name: "assistant-tools",
    version: "1.0.0",
    tools: [
      tool(
        "buckets",
        "Manage email buckets and assign threads to them. Buckets are categories for organizing email threads.",
        {
          action: z.enum(["list", "create", "update", "delete", "assign"]),
          id: z.string().optional().describe("Bucket ID (for update/delete)"),
          name: z.string().optional().describe("Bucket name (for create/update)"),
          description: z.string().optional().describe("Bucket description (for create/update)"),
          sort_order: z.number().optional().describe("Display order (for update)"),
          assignments: z
            .array(
              z.object({
                gmail_thread_id: z.string(),
                bucket_id: z.string(),
                subject: z.string().optional(),
                snippet: z.string().optional(),
              }),
            )
            .max(BATCH_SIZE)
            .optional()
            .describe("Thread-to-bucket assignments (1-25). For assign action."),
        },
        handlers.buckets,
      ),

      tool(
        "sync_email",
        "Read email data. All email reads go through this tool. Actions: sync (bulk inbox refresh), search (find specific threads), get_thread (single thread), get_unbucketed (for bucketing workflow).",
        {
          action: z.enum(["sync", "search", "get_thread", "get_unbucketed"]),
          query: z
            .string()
            .optional()
            .describe('Gmail search query (e.g., "from:dan@acme.co", "subject:contract")'),
          max_results: z
            .number()
            .optional()
            .describe("Max threads for sync/search (default 200 for sync, 25 for search)"),
          thread_id: z.string().optional().describe("Gmail thread ID for get_thread action"),
        },
        handlers.sync_email,
      ),

      tool(
        "action_email",
        "Perform actions on emails: send, reply, draft, trash, mark as read. All write operations require user approval.",
        {
          action: z.enum(["send", "reply", "draft", "trash", "mark_read"]),
          to: z.string().optional(),
          cc: z.array(z.string()).optional(),
          subject: z.string().optional(),
          body: z.string().optional(),
          thread_id: z.string().optional(),
          message_id: z.string().optional(),
        },
        handlers.action_email,
      ),

      tool(
        "calendar",
        "Read, create, update, and delete Google Calendar events. Check availability. Write actions (create, update, delete) require user approval.",
        {
          action: z.enum(["list", "get", "create", "update", "delete", "free_busy"]),
          time_min: z.string().optional().describe("ISO 8601 datetime (list, free_busy)"),
          time_max: z.string().optional().describe("ISO 8601 datetime (list, free_busy)"),
          event_id: z.string().optional().describe("Event ID (get, update, delete)"),
          summary: z.string().optional().describe("Event title (create, update)"),
          description: z.string().optional().describe("Event description (create, update)"),
          location: z.string().optional().describe("Event location (create, update)"),
          start: z.string().optional().describe("ISO 8601 start time (create, update)"),
          end: z.string().optional().describe("ISO 8601 end time (create, update)"),
          attendees: z.array(z.string()).optional().describe("Email addresses (create, update)"),
          query: z.string().optional().describe("Free text search (list)"),
        },
        handlers.calendar,
      ),

      tool(
        "drive",
        "Search Google Drive files and read Google Docs content. Read-only — no confirmation needed.",
        {
          action: z.enum(["search", "list_recent", "read", "metadata"]),
          query: z.string().optional().describe("Search query (search)"),
          file_id: z.string().optional().describe("File ID (read, metadata)"),
          max_results: z.number().optional().describe("Max results (search, list_recent)"),
        },
        handlers.drive,
      ),
    ],
  });
}
