import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../../src/server/exceptions.js";
import { db, pool } from "../../../src/server/db/index.js";
import {
  buckets,
  bucketTemplates,
  chatMessages,
  conversations,
  emailThreads,
  threadBuckets,
} from "../../../src/server/db/schema.js";
import {
  applyBucketTemplate,
  assignThread,
  assignThreadsBatch,
  createChatMessage,
  createConversation,
  upsertEmailThread,
} from "../../../src/server/db/queries.js";

async function cleanDatabase() {
  await db.execute(
    `TRUNCATE TABLE chat_messages, conversations, thread_buckets, email_messages, email_threads, buckets, bucket_templates, google_tokens CASCADE`,
  );
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe("applyBucketTemplate", () => {
  it("creates buckets from template", async () => {
    const [template] = await db
      .insert(bucketTemplates)
      .values({
        name: "Test",
        description: "A test template",
        buckets: [
          { name: "Alpha", description: "First bucket", sort_order: 0 },
          { name: "Beta", description: "Second bucket", sort_order: 1 },
        ],
      })
      .returning();

    await applyBucketTemplate(template.id);

    const created = await db.select().from(buckets);
    expect(created).toHaveLength(2);
    expect(created.map((b) => b.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("throws AppError 409 when buckets already exist", async () => {
    const [template] = await db
      .insert(bucketTemplates)
      .values({
        name: "Test",
        description: "A test template",
        buckets: [{ name: "Alpha", description: "First bucket", sort_order: 0 }],
      })
      .returning();

    await db.insert(buckets).values({ name: "Existing", description: "pre-existing", sort_order: 0 });

    await expect(applyBucketTemplate(template.id)).rejects.toMatchObject({
      status: 409,
    });
    await expect(applyBucketTemplate(template.id)).rejects.toBeInstanceOf(AppError);
  });
});

describe("createChatMessage", () => {
  it("updates conversations.updated_at after insert", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ title: "Test", updated_at: new Date("2020-01-01T00:00:00Z") })
      .returning();

    await createChatMessage(conv.id, "user", "Hello");

    const [updated] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(updated.updated_at.getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
  });

  it("persists the message", async () => {
    const [conv] = await db.insert(conversations).values({ title: "Test" }).returning();

    const msg = await createChatMessage(conv.id, "user", "Hello world");

    expect(msg.content).toBe("Hello world");
    expect(msg.role).toBe("user");
    expect(msg.conversation_id).toBe(conv.id);

    const stored = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversation_id, conv.id));
    expect(stored).toHaveLength(1);
  });
});

describe("assignThreadsBatch", () => {
  it("inserts all assignments within batch limit", async () => {
    const [bucket] = await db
      .insert(buckets)
      .values({ name: "Inbox", description: "test", sort_order: 0 })
      .returning();

    const threadIds = ["t1", "t2", "t3"];
    for (const tid of threadIds) {
      await db.insert(emailThreads).values({ gmail_thread_id: tid, message_count: 1 });
    }

    await assignThreadsBatch(threadIds.map((id) => ({ gmailThreadId: id, bucketId: bucket.id })));

    const rows = await db.select().from(threadBuckets);
    expect(rows).toHaveLength(3);
  });

  it("throws AppError when assignments exceed 25", async () => {
    const assignments = Array.from({ length: 26 }, (_, i) => ({
      gmailThreadId: `thread-${i}`,
      bucketId: "00000000-0000-0000-0000-000000000000",
    }));

    await expect(assignThreadsBatch(assignments)).rejects.toBeInstanceOf(AppError);
  });
});

describe("upsertEmailThread", () => {
  it("inserts new thread", async () => {
    await upsertEmailThread({ gmail_thread_id: "abc123", subject: "Hello", message_count: 1 });

    const rows = await db.select().from(emailThreads);
    expect(rows).toHaveLength(1);
    expect(rows[0].gmail_thread_id).toBe("abc123");
  });

  it("updates existing thread on conflict", async () => {
    await upsertEmailThread({ gmail_thread_id: "abc123", subject: "First", message_count: 1 });
    await upsertEmailThread({ gmail_thread_id: "abc123", subject: "Updated", message_count: 2 });

    const rows = await db.select().from(emailThreads);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Updated");
    expect(rows[0].message_count).toBe(2);
  });
});

describe("assignThread", () => {
  it("moves thread to new bucket on second assignment", async () => {
    const [b1] = await db
      .insert(buckets)
      .values({ name: "Bucket A", description: "a", sort_order: 0 })
      .returning();
    const [b2] = await db
      .insert(buckets)
      .values({ name: "Bucket B", description: "b", sort_order: 1 })
      .returning();
    await db.insert(emailThreads).values({ gmail_thread_id: "thread-x", message_count: 1 });

    await assignThread("thread-x", b1.id);
    await assignThread("thread-x", b2.id);

    const rows = await db.select().from(threadBuckets);
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket_id).toBe(b2.id);
  });
});

describe("createConversation", () => {
  it("returns a conversation with the given title", async () => {
    const conv = await createConversation("My convo");
    expect(conv.title).toBe("My convo");
    expect(conv.id).toBeTruthy();
  });
});
