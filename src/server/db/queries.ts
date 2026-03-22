import { desc, eq, inArray, not, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../exceptions.js";
import { db } from "./index.js";
import {
  buckets,
  bucketTemplates,
  chatMessages,
  conversations,
  emailMessages,
  emailThreads,
  googleTokens,
  threadBuckets,
} from "./schema.js";

const BATCH_SIZE = 25;

const BucketDefinitionSchema = z.array(
  z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    sort_order: z.number().int().min(0),
  }),
);

export async function getGoogleTokens() {
  const [row] = await db.select().from(googleTokens).where(eq(googleTokens.id, "primary"));
  return row ?? null;
}

export async function upsertGoogleTokens(tokens: {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: Date;
}) {
  const [row] = await db
    .insert(googleTokens)
    .values({ id: "primary", ...tokens, updated_at: new Date() })
    .onConflictDoUpdate({
      target: googleTokens.id,
      set: { ...tokens, updated_at: new Date() },
    })
    .returning();
  return row;
}

export async function listBucketTemplates() {
  return db.select().from(bucketTemplates);
}

export async function getBucketTemplate(id: string) {
  const [row] = await db.select().from(bucketTemplates).where(eq(bucketTemplates.id, id));
  return row ?? null;
}

export async function applyBucketTemplate(id: string) {
  const template = await getBucketTemplate(id);
  if (!template) {
    throw new AppError(`Bucket template not found: ${id}`, 404, { userFacing: true });
  }

  const items = BucketDefinitionSchema.parse(template.buckets);

  const existing = await db.select().from(buckets);
  if (existing.length > 0) {
    throw new AppError(
      "Buckets already exist — delete all buckets before applying a template",
      409,
      {
        userFacing: true,
      },
    );
  }

  return db
    .insert(buckets)
    .values(
      items.map((item) => ({
        name: item.name,
        description: item.description,
        sort_order: item.sort_order,
      })),
    )
    .returning();
}

export async function listBuckets() {
  return db.select().from(buckets).orderBy(buckets.sort_order);
}

export async function createBucket(name: string, description: string) {
  const [row] = await db.insert(buckets).values({ name, description }).returning();
  return row;
}

export async function updateBucket(
  id: string,
  updates: { name?: string; description?: string; sort_order?: number },
) {
  const [row] = await db.update(buckets).set(updates).where(eq(buckets.id, id)).returning();
  if (!row) {
    throw new AppError(`Bucket not found: ${id}`, 404, { userFacing: true });
  }
  return row;
}

export async function deleteBucket(id: string) {
  await db.delete(buckets).where(eq(buckets.id, id));
}

export async function upsertEmailThread(threadData: {
  gmail_thread_id: string;
  subject?: string;
  snippet?: string;
  from_email?: string;
  from_name?: string;
  last_message_at?: Date;
  message_count?: number;
  label_ids?: unknown;
  gmail_history_id?: string;
}) {
  const now = new Date();
  const [row] = await db
    .insert(emailThreads)
    .values({ ...threadData, message_count: threadData.message_count ?? 1, synced_at: now })
    .onConflictDoUpdate({
      target: emailThreads.gmail_thread_id,
      set: { ...threadData, synced_at: now },
    })
    .returning();
  return row;
}

export async function upsertEmailMessages(
  messages: Array<{
    gmail_message_id: string;
    gmail_thread_id: string;
    from_email?: string;
    from_name?: string;
    to_emails?: unknown;
    cc_emails?: unknown;
    subject?: string;
    body_text?: string;
    received_at: Date;
  }>,
) {
  if (messages.length === 0) return [];
  const now = new Date();
  const values = messages.map((m) => ({
    ...m,
    body_text: m.body_text ? m.body_text.slice(0, 2000) : m.body_text,
    synced_at: now,
  }));
  return db
    .insert(emailMessages)
    .values(values)
    .onConflictDoUpdate({
      target: emailMessages.gmail_message_id,
      set: {
        from_email: sql`excluded.from_email`,
        from_name: sql`excluded.from_name`,
        to_emails: sql`excluded.to_emails`,
        cc_emails: sql`excluded.cc_emails`,
        subject: sql`excluded.subject`,
        body_text: sql`excluded.body_text`,
        synced_at: sql`excluded.synced_at`,
      },
    })
    .returning();
}

export async function getEmailThread(gmailThreadId: string) {
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.gmail_thread_id, gmailThreadId));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.gmail_thread_id, gmailThreadId))
    .orderBy(emailMessages.received_at);
  return { ...thread, messages };
}

export async function listEmailThreads() {
  return db.select().from(emailThreads).orderBy(desc(emailThreads.last_message_at));
}

export async function listEmailThreadsByGmailIds(gmailIds: string[]) {
  if (gmailIds.length === 0) return [];
  return db.select().from(emailThreads).where(inArray(emailThreads.gmail_thread_id, gmailIds));
}

export async function listThreadsByBucket(bucketId: string) {
  return db.select().from(threadBuckets).where(eq(threadBuckets.bucket_id, bucketId));
}

export async function assignThread(
  gmailThreadId: string,
  bucketId: string,
  subject?: string,
  snippet?: string,
) {
  const [row] = await db
    .insert(threadBuckets)
    .values({ gmail_thread_id: gmailThreadId, bucket_id: bucketId, subject, snippet })
    .onConflictDoUpdate({
      target: threadBuckets.gmail_thread_id,
      set: { bucket_id: bucketId, subject, snippet, assigned_at: new Date() },
    })
    .returning();
  return row;
}

export async function unassignThread(gmailThreadId: string) {
  await db.delete(threadBuckets).where(eq(threadBuckets.gmail_thread_id, gmailThreadId));
}

export async function listBucketsWithThreads() {
  const allBuckets = await db.select().from(buckets).orderBy(buckets.sort_order);
  const allThreadBuckets = await db
    .select({
      id: threadBuckets.id,
      gmail_thread_id: threadBuckets.gmail_thread_id,
      bucket_id: threadBuckets.bucket_id,
      subject: threadBuckets.subject,
      snippet: threadBuckets.snippet,
      assigned_at: threadBuckets.assigned_at,
      from_name: emailThreads.from_name,
      from_email: emailThreads.from_email,
      last_message_at: emailThreads.last_message_at,
    })
    .from(threadBuckets)
    .leftJoin(emailThreads, eq(threadBuckets.gmail_thread_id, emailThreads.gmail_thread_id))
    .orderBy(desc(emailThreads.last_message_at));
  return allBuckets.map((bucket) => ({
    ...bucket,
    threads: allThreadBuckets.filter((tb) => tb.bucket_id === bucket.id),
  }));
}

export async function getUnbucketedThreads(limit: number) {
  const cappedLimit = Math.min(limit, BATCH_SIZE);
  const assigned = db.select({ id: threadBuckets.gmail_thread_id }).from(threadBuckets);
  return db
    .select()
    .from(emailThreads)
    .where(not(inArray(emailThreads.gmail_thread_id, assigned)))
    .limit(cappedLimit);
}

export async function countUnbucketedThreads() {
  const assigned = db.select({ id: threadBuckets.gmail_thread_id }).from(threadBuckets);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThreads)
    .where(not(inArray(emailThreads.gmail_thread_id, assigned)));
  return row.count;
}

export async function assignThreadsBatch(
  assignments: Array<{
    gmailThreadId: string;
    bucketId: string;
    subject?: string;
    snippet?: string;
  }>,
) {
  if (assignments.length > BATCH_SIZE) {
    throw new AppError(`Batch size ${assignments.length} exceeds limit of ${BATCH_SIZE}`, 400, {
      userFacing: true,
    });
  }
  if (assignments.length === 0) return [];
  return db.transaction(async (tx) => {
    return tx
      .insert(threadBuckets)
      .values(
        assignments.map((a) => ({
          gmail_thread_id: a.gmailThreadId,
          bucket_id: a.bucketId,
          subject: a.subject,
          snippet: a.snippet,
        })),
      )
      .onConflictDoUpdate({
        target: threadBuckets.gmail_thread_id,
        set: {
          bucket_id: sql`excluded.bucket_id`,
          subject: sql`excluded.subject`,
          snippet: sql`excluded.snippet`,
          assigned_at: sql`excluded.assigned_at`,
        },
      })
      .returning();
  });
}

export async function markAllForRebucket() {
  await db.update(threadBuckets).set({ needs_rebucket: true });
}

export async function getThreadsNeedingRebucket(limit: number) {
  return db
    .select({ threadBucket: threadBuckets, thread: emailThreads })
    .from(threadBuckets)
    .innerJoin(emailThreads, eq(threadBuckets.gmail_thread_id, emailThreads.gmail_thread_id))
    .where(eq(threadBuckets.needs_rebucket, true))
    .limit(Math.min(limit, BATCH_SIZE));
}

export async function clearRebucketFlag(gmailThreadIds: string[]) {
  if (gmailThreadIds.length === 0) return;
  await db
    .update(threadBuckets)
    .set({ needs_rebucket: false })
    .where(inArray(threadBuckets.gmail_thread_id, gmailThreadIds));
}

export async function listConversations() {
  return db.select().from(conversations).orderBy(desc(conversations.updated_at));
}

export async function getConversation(id: string) {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  return row ?? null;
}

export async function createConversation(title: string) {
  const [row] = await db.insert(conversations).values({ title }).returning();
  return row;
}

export async function updateConversation(
  id: string,
  updates: { title?: string; sdk_session_id?: string },
) {
  const [row] = await db
    .update(conversations)
    .set(updates)
    .where(eq(conversations.id, id))
    .returning();
  if (!row) {
    throw new AppError(`Conversation not found: ${id}`, 404, { userFacing: true });
  }
  return row;
}

export async function deleteConversation(id: string) {
  await db.delete(conversations).where(eq(conversations.id, id));
}

export async function listMessagesByConversation(conversationId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversation_id, conversationId))
    .orderBy(chatMessages.created_at);
}

export async function createChatMessage(conversationId: string, role: string, content: string) {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(chatMessages)
      .values({ conversation_id: conversationId, role, content })
      .returning();
    await tx
      .update(conversations)
      .set({ updated_at: new Date() })
      .where(eq(conversations.id, conversationId));
    return message;
  });
}
