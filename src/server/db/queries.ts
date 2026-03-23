import { and, desc, eq, inArray, not, sql } from "drizzle-orm";
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
  users,
} from "./schema.js";

// Users

export async function upsertUser(email: string, name?: string, avatarUrl?: string) {
  const [row] = await db
    .insert(users)
    .values({ email, name: name ?? null, avatar_url: avatarUrl ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: name ?? null, avatar_url: avatarUrl ?? null },
    })
    .returning();
  return row;
}

// Google Tokens

export async function getGoogleTokens(userId: string) {
  const [row] = await db.select().from(googleTokens).where(eq(googleTokens.user_id, userId));
  return row ?? null;
}

export async function upsertGoogleTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expiry_date: Date;
  },
) {
  const [row] = await db
    .insert(googleTokens)
    .values({ user_id: userId, ...tokens, updated_at: new Date() })
    .onConflictDoUpdate({
      target: googleTokens.user_id,
      set: { ...tokens, updated_at: new Date() },
    })
    .returning();
  return row;
}

// Bucket Templates

export async function listBucketTemplates() {
  return db.select().from(bucketTemplates);
}

export async function getBucketTemplate(id: string) {
  const [row] = await db.select().from(bucketTemplates).where(eq(bucketTemplates.id, id));
  return row ?? null;
}

export async function insertBuckets(
  userId: string,
  items: Array<{ name: string; description: string; sort_order: number }>,
) {
  return db
    .insert(buckets)
    .values(
      items.map((item) => ({
        user_id: userId,
        name: item.name,
        description: item.description,
        sort_order: item.sort_order,
      })),
    )
    .returning();
}

// Buckets

export async function getBucket(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(buckets)
    .where(and(eq(buckets.id, id), eq(buckets.user_id, userId)));
  return row ?? null;
}

export async function listBuckets(userId: string) {
  return db.select().from(buckets).where(eq(buckets.user_id, userId)).orderBy(buckets.sort_order);
}

export async function listBucketsByIds(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(buckets)
    .where(and(inArray(buckets.id, ids), eq(buckets.user_id, userId)));
}

export async function createBucket(userId: string, name: string, description: string) {
  const [row] = await db.insert(buckets).values({ user_id: userId, name, description }).returning();
  return row;
}

export async function updateBucket(
  userId: string,
  id: string,
  updates: { name?: string; description?: string; sort_order?: number },
) {
  const [row] = await db
    .update(buckets)
    .set(updates)
    .where(and(eq(buckets.id, id), eq(buckets.user_id, userId)))
    .returning();
  if (!row) {
    throw new AppError(`Bucket not found: ${id}`, 404, { userFacing: true });
  }
  return row;
}

export async function deleteBucket(userId: string, id: string) {
  await db.delete(buckets).where(and(eq(buckets.id, id), eq(buckets.user_id, userId)));
}

export async function markAllForRebucket(userId: string) {
  await db
    .update(threadBuckets)
    .set({ needs_rebucket: true })
    .where(eq(threadBuckets.user_id, userId));
}

export async function listBucketsWithThreads(userId: string) {
  const allBuckets = await db
    .select()
    .from(buckets)
    .where(eq(buckets.user_id, userId))
    .orderBy(buckets.sort_order);
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
    .leftJoin(
      emailThreads,
      and(
        eq(threadBuckets.gmail_thread_id, emailThreads.gmail_thread_id),
        eq(emailThreads.user_id, threadBuckets.user_id),
      ),
    )
    .innerJoin(buckets, eq(threadBuckets.bucket_id, buckets.id))
    .where(eq(buckets.user_id, userId))
    .orderBy(desc(emailThreads.last_message_at));
  return allBuckets.map((bucket) => ({
    ...bucket,
    threads: allThreadBuckets.filter((tb) => tb.bucket_id === bucket.id),
  }));
}

export async function listThreadsByBucket(userId: string, bucketId: string) {
  return db
    .select({
      id: threadBuckets.id,
      gmail_thread_id: threadBuckets.gmail_thread_id,
      bucket_id: threadBuckets.bucket_id,
      subject: threadBuckets.subject,
      snippet: threadBuckets.snippet,
      needs_rebucket: threadBuckets.needs_rebucket,
      assigned_at: threadBuckets.assigned_at,
    })
    .from(threadBuckets)
    .innerJoin(buckets, eq(threadBuckets.bucket_id, buckets.id))
    .where(and(eq(threadBuckets.bucket_id, bucketId), eq(buckets.user_id, userId)));
}

// Thread Buckets

export async function upsertThreadBucket(
  userId: string,
  gmailThreadId: string,
  bucketId: string,
  subject?: string,
  snippet?: string,
) {
  const [row] = await db
    .insert(threadBuckets)
    .values({
      user_id: userId,
      gmail_thread_id: gmailThreadId,
      bucket_id: bucketId,
      subject,
      snippet,
    })
    .onConflictDoUpdate({
      target: [threadBuckets.user_id, threadBuckets.gmail_thread_id],
      set: { bucket_id: bucketId, subject, snippet, assigned_at: new Date() },
    })
    .returning();
  return row;
}

export async function unassignThread(userId: string, gmailThreadId: string) {
  await db
    .delete(threadBuckets)
    .where(
      and(eq(threadBuckets.gmail_thread_id, gmailThreadId), eq(threadBuckets.user_id, userId)),
    );
}

export async function upsertThreadBuckets(
  userId: string,
  assignments: Array<{
    gmailThreadId: string;
    bucketId: string;
    subject?: string;
    snippet?: string;
  }>,
) {
  return db.transaction(async (tx) => {
    return tx
      .insert(threadBuckets)
      .values(
        assignments.map((a) => ({
          user_id: userId,
          gmail_thread_id: a.gmailThreadId,
          bucket_id: a.bucketId,
          subject: a.subject,
          snippet: a.snippet,
        })),
      )
      .onConflictDoUpdate({
        target: [threadBuckets.user_id, threadBuckets.gmail_thread_id],
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

export async function getUnbucketedThreads(userId: string, limit: number) {
  const assigned = db
    .select({ id: threadBuckets.gmail_thread_id })
    .from(threadBuckets)
    .where(eq(threadBuckets.user_id, userId));
  return db
    .select()
    .from(emailThreads)
    .where(
      and(eq(emailThreads.user_id, userId), not(inArray(emailThreads.gmail_thread_id, assigned))),
    )
    .limit(limit);
}

export async function countUnbucketedThreads(userId: string) {
  const assigned = db
    .select({ id: threadBuckets.gmail_thread_id })
    .from(threadBuckets)
    .where(eq(threadBuckets.user_id, userId));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThreads)
    .where(
      and(eq(emailThreads.user_id, userId), not(inArray(emailThreads.gmail_thread_id, assigned))),
    );
  return row.count;
}

// Email Threads

export async function upsertEmailThread(
  userId: string,
  threadData: {
    gmail_thread_id: string;
    subject?: string;
    snippet?: string;
    from_email?: string;
    from_name?: string;
    last_message_at?: Date;
    message_count?: number;
    label_ids?: unknown;
    gmail_history_id?: string;
  },
) {
  const now = new Date();
  const [row] = await db
    .insert(emailThreads)
    .values({
      user_id: userId,
      ...threadData,
      message_count: threadData.message_count ?? 1,
      synced_at: now,
    })
    .onConflictDoUpdate({
      target: [emailThreads.user_id, emailThreads.gmail_thread_id],
      set: { ...threadData, synced_at: now },
    })
    .returning();
  return row;
}

export async function upsertEmailMessages(
  userId: string,
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
    user_id: userId,
    body_text: m.body_text ? m.body_text.slice(0, 2000) : m.body_text,
    synced_at: now,
  }));
  return db
    .insert(emailMessages)
    .values(values)
    .onConflictDoUpdate({
      target: [emailMessages.user_id, emailMessages.gmail_message_id],
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

export async function getEmailThread(userId: string, gmailThreadId: string) {
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.gmail_thread_id, gmailThreadId), eq(emailThreads.user_id, userId)));
  if (!thread) return null;
  const messages = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.gmail_thread_id, gmailThreadId), eq(emailMessages.user_id, userId)))
    .orderBy(emailMessages.received_at);
  return { ...thread, messages };
}

export async function listEmailThreadsByGmailIds(userId: string, gmailIds: string[]) {
  if (gmailIds.length === 0) return [];
  return db
    .select()
    .from(emailThreads)
    .where(and(inArray(emailThreads.gmail_thread_id, gmailIds), eq(emailThreads.user_id, userId)));
}

// Conversations

export async function listConversations(userId: string) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.user_id, userId))
    .orderBy(desc(conversations.updated_at));
}

export async function getConversation(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)));
  return row ?? null;
}

export async function createConversation(userId: string, title: string) {
  const [row] = await db.insert(conversations).values({ user_id: userId, title }).returning();
  return row;
}

export async function updateConversation(
  userId: string,
  id: string,
  updates: { title?: string; sdk_session_id?: string },
) {
  const [row] = await db
    .update(conversations)
    .set(updates)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
    .returning();
  if (!row) {
    throw new AppError(`Conversation not found: ${id}`, 404, { userFacing: true });
  }
  return row;
}

export async function deleteConversation(userId: string, id: string) {
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)));
}

export async function listMessagesByConversation(userId: string, conversationId: string) {
  const conv = await getConversation(userId, conversationId);
  if (!conv)
    throw new AppError(`Conversation not found: ${conversationId}`, 404, { userFacing: true });
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversation_id, conversationId))
    .orderBy(chatMessages.created_at);
}

export async function createChatMessage(
  userId: string,
  conversationId: string,
  role: string,
  content: string,
) {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.user_id, userId)));
    if (!conv) {
      throw new AppError(`Conversation not found: ${conversationId}`, 404, { userFacing: true });
    }
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
