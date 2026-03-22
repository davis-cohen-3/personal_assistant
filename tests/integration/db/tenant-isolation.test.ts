import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../../src/server/db/index.js";
import {
  buckets,
  chatMessages,
  conversations,
  emailThreads,
  threadBuckets,
} from "../../../src/server/db/schema.js";
import {
  applyBucketTemplate,
  assignThread,
  assignThreadsBatch,
  countUnbucketedThreads,
  createBucket,
  createChatMessage,
  createConversation,
  deleteBucket,
  deleteConversation,
  getConversation,
  getEmailThread,
  getUnbucketedThreads,
  listBuckets,
  listBucketsWithThreads,
  listConversations,
  listEmailThreadsByGmailIds,
  listMessagesByConversation,
  listThreadsByBucket,
  markAllForRebucket,
  unassignThread,
  updateBucket,
  updateConversation,
  upsertEmailThread,
  upsertUser,
} from "../../../src/server/db/queries.js";
import { AppError } from "../../../src/server/exceptions.js";

let userA: string;
let userB: string;

async function cleanDatabase() {
  await db.execute(
    `TRUNCATE TABLE chat_messages, conversations, thread_buckets, email_messages, email_threads, buckets, bucket_templates, google_tokens, users CASCADE`,
  );
}

beforeEach(async () => {
  await cleanDatabase();
  const a = await upsertUser("alice@example.com", "Alice");
  const b = await upsertUser("bob@example.com", "Bob");
  userA = a.id;
  userB = b.id;
});

afterAll(async () => {
  await pool.end();
});

describe("bucket isolation", () => {
  it("listBuckets returns only the user's buckets", async () => {
    await createBucket(userA, "Alice Bucket", "for alice");
    await createBucket(userB, "Bob Bucket", "for bob");

    const aBuckets = await listBuckets(userA);
    const bBuckets = await listBuckets(userB);

    expect(aBuckets).toHaveLength(1);
    expect(aBuckets[0].name).toBe("Alice Bucket");
    expect(bBuckets).toHaveLength(1);
    expect(bBuckets[0].name).toBe("Bob Bucket");
  });

  it("updateBucket cannot modify another user's bucket", async () => {
    const bucket = await createBucket(userA, "Alice Only", "private");

    await expect(
      updateBucket(userB, bucket.id, { name: "Stolen" }),
    ).rejects.toBeInstanceOf(AppError);

    const [row] = await db.select().from(buckets).where(eq(buckets.id, bucket.id));
    expect(row.name).toBe("Alice Only");
  });

  it("deleteBucket cannot delete another user's bucket", async () => {
    const bucket = await createBucket(userA, "Alice Only", "private");

    await deleteBucket(userB, bucket.id);

    const [row] = await db.select().from(buckets).where(eq(buckets.id, bucket.id));
    expect(row).toBeDefined();
  });

  it("listBucketsWithThreads returns only the user's data", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await createBucket(userB, "B Bucket", "b");
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await assignThread(userA, "t1", aBucket.id);

    const aData = await listBucketsWithThreads(userA);
    const bData = await listBucketsWithThreads(userB);

    expect(aData).toHaveLength(1);
    expect(aData[0].threads).toHaveLength(1);
    expect(bData).toHaveLength(1);
    expect(bData[0].threads).toHaveLength(0);
  });
});

describe("email thread isolation", () => {
  it("getEmailThread returns null for another user's thread", async () => {
    await upsertEmailThread(userA, { gmail_thread_id: "t1", subject: "Alice's", message_count: 1 });

    const result = await getEmailThread(userB, "t1");

    expect(result).toBeNull();
  });

  it("listEmailThreadsByGmailIds returns only the user's threads", async () => {
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await upsertEmailThread(userB, { gmail_thread_id: "t2", message_count: 1 });

    const aThreads = await listEmailThreadsByGmailIds(userA, ["t1", "t2"]);
    const bThreads = await listEmailThreadsByGmailIds(userB, ["t1", "t2"]);

    expect(aThreads).toHaveLength(1);
    expect(aThreads[0].gmail_thread_id).toBe("t1");
    expect(bThreads).toHaveLength(1);
    expect(bThreads[0].gmail_thread_id).toBe("t2");
  });
});

describe("thread assignment isolation", () => {
  it("assignThread rejects assigning to another user's bucket", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await upsertEmailThread(userB, { gmail_thread_id: "t1", message_count: 1 });

    await expect(
      assignThread(userB, "t1", aBucket.id),
    ).rejects.toBeInstanceOf(AppError);

    const rows = await db.select().from(threadBuckets);
    expect(rows).toHaveLength(0);
  });

  it("assignThreadsBatch rejects when any bucket belongs to another user", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await upsertEmailThread(userB, { gmail_thread_id: "t1", message_count: 1 });

    await expect(
      assignThreadsBatch(userB, [{ gmailThreadId: "t1", bucketId: aBucket.id }]),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("listThreadsByBucket returns empty for another user's bucket", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await assignThread(userA, "t1", aBucket.id);

    const result = await listThreadsByBucket(userB, aBucket.id);

    expect(result).toHaveLength(0);
  });

  it("unassignThread does not affect another user's assignments", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await assignThread(userA, "t1", aBucket.id);

    await unassignThread(userB, "t1");

    const rows = await db.select().from(threadBuckets);
    expect(rows).toHaveLength(1);
  });

  it("markAllForRebucket only affects the user's threads", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    const bBucket = await createBucket(userB, "B Bucket", "b");
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await upsertEmailThread(userB, { gmail_thread_id: "t2", message_count: 1 });
    await assignThread(userA, "t1", aBucket.id);
    await assignThread(userB, "t2", bBucket.id);

    await markAllForRebucket(userA);

    const rows = await db.select().from(threadBuckets);
    const aRow = rows.find((r) => r.gmail_thread_id === "t1");
    const bRow = rows.find((r) => r.gmail_thread_id === "t2");
    expect(aRow!.needs_rebucket).toBe(true);
    expect(bRow!.needs_rebucket).toBe(false);
  });
});

describe("unbucketed thread isolation", () => {
  it("getUnbucketedThreads returns only the user's unbucketed threads", async () => {
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await upsertEmailThread(userB, { gmail_thread_id: "t2", message_count: 1 });

    const aResult = await getUnbucketedThreads(userA, 25);
    const bResult = await getUnbucketedThreads(userB, 25);

    expect(aResult).toHaveLength(1);
    expect(aResult[0].gmail_thread_id).toBe("t1");
    expect(bResult).toHaveLength(1);
    expect(bResult[0].gmail_thread_id).toBe("t2");
  });

  it("countUnbucketedThreads counts only the user's unbucketed threads", async () => {
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await upsertEmailThread(userA, { gmail_thread_id: "t2", message_count: 1 });
    await upsertEmailThread(userB, { gmail_thread_id: "t3", message_count: 1 });

    const aCount = await countUnbucketedThreads(userA);
    const bCount = await countUnbucketedThreads(userB);

    expect(aCount).toBe(2);
    expect(bCount).toBe(1);
  });

  it("bucketing a thread for one user does not affect another user's count", async () => {
    const aBucket = await createBucket(userA, "A Bucket", "a");
    await upsertEmailThread(userA, { gmail_thread_id: "t1", message_count: 1 });
    await upsertEmailThread(userB, { gmail_thread_id: "t2", message_count: 1 });
    await assignThread(userA, "t1", aBucket.id);

    const aCount = await countUnbucketedThreads(userA);
    const bCount = await countUnbucketedThreads(userB);

    expect(aCount).toBe(0);
    expect(bCount).toBe(1);
  });
});

describe("conversation isolation", () => {
  it("listConversations returns only the user's conversations", async () => {
    await createConversation(userA, "Alice Chat");
    await createConversation(userB, "Bob Chat");

    const aConvos = await listConversations(userA);
    const bConvos = await listConversations(userB);

    expect(aConvos).toHaveLength(1);
    expect(aConvos[0].title).toBe("Alice Chat");
    expect(bConvos).toHaveLength(1);
    expect(bConvos[0].title).toBe("Bob Chat");
  });

  it("getConversation returns null for another user's conversation", async () => {
    const conv = await createConversation(userA, "Alice Only");

    const result = await getConversation(userB, conv.id);

    expect(result).toBeNull();
  });

  it("updateConversation cannot modify another user's conversation", async () => {
    const conv = await createConversation(userA, "Original");

    await expect(
      updateConversation(userB, conv.id, { title: "Hijacked" }),
    ).rejects.toBeInstanceOf(AppError);

    const row = await getConversation(userA, conv.id);
    expect(row!.title).toBe("Original");
  });

  it("deleteConversation cannot delete another user's conversation", async () => {
    const conv = await createConversation(userA, "Keep Me");

    await deleteConversation(userB, conv.id);

    const row = await getConversation(userA, conv.id);
    expect(row).not.toBeNull();
  });

  it("listMessagesByConversation rejects for another user's conversation", async () => {
    const conv = await createConversation(userA, "Alice Chat");
    await createChatMessage(userA, conv.id, "user", "Hello");

    await expect(
      listMessagesByConversation(userB, conv.id),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("createChatMessage updates only the owning user's conversation timestamp", async () => {
    const aConv = await createConversation(userA, "Alice Chat");
    const bConv = await createConversation(userB, "Bob Chat");

    await createChatMessage(userA, aConv.id, "user", "Hello from Alice");

    const aRow = await getConversation(userA, aConv.id);
    const bRow = await getConversation(userB, bConv.id);
    expect(aRow!.updated_at.getTime()).toBeGreaterThanOrEqual(bRow!.updated_at.getTime());
  });
});
