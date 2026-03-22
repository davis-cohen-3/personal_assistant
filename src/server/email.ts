import pLimit from "p-limit";
import * as queries from "./db/queries.js";
import { withUserTokens } from "./google/auth.js";
import type { GmailMessage, GmailThread } from "./google/gmail.js";
import * as gmail from "./google/gmail.js";

const BATCH_SIZE = 25;
const DEFAULT_SYNC_LIMIT = 200;
const limit = pLimit(5);

function extractBodyText(msg: GmailMessage): string {
  if (msg.bodyText) return msg.bodyText;
  return msg.bodyHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrom(from: string): { from_email: string; from_name: string } {
  const match = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { from_name: match[1].trim(), from_email: match[2].trim() };
  }
  return { from_name: "", from_email: from.trim() };
}

function toThreadRecord(full: GmailThread, snippet?: string) {
  const lastMsg = full.messages.at(-1);
  if (!lastMsg) {
    return { gmail_thread_id: full.id, snippet };
  }
  const { from_email, from_name } = parseFrom(lastMsg.from);
  return {
    gmail_thread_id: full.id,
    subject: lastMsg.subject || undefined,
    snippet,
    from_email: from_email || undefined,
    from_name: from_name || undefined,
    last_message_at: new Date(parseInt(lastMsg.internalDate)),
    message_count: full.messages.length,
    label_ids: lastMsg.labelIds,
  };
}

function toMessageRecords(messages: GmailMessage[]) {
  return messages.map((msg) => {
    const { from_email, from_name } = parseFrom(msg.from);
    return {
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      from_email: from_email || undefined,
      from_name: from_name || undefined,
      to_emails: msg.to ? [msg.to] : undefined,
      subject: msg.subject || undefined,
      body_text: extractBodyText(msg),
      received_at: new Date(parseInt(msg.internalDate)),
    };
  });
}

export async function syncInbox(
  userId: string,
  maxResults?: number,
): Promise<{ new: number; updated: number }> {
  const auth = await withUserTokens(userId);
  const syncLimit = maxResults ?? DEFAULT_SYNC_LIMIT;
  const gmailThreads = await gmail.searchThreads(auth, "is:inbox", syncLimit);

  const gmailIds = gmailThreads.map((t) => t.id);
  const existing = await queries.listEmailThreadsByGmailIds(userId, gmailIds);
  const existingMap = new Map(existing.map((t) => [t.gmail_thread_id, t]));

  let newCount = 0;
  let updatedCount = 0;

  const threadsToSync = gmailThreads.filter((thread) => {
    const local = existingMap.get(thread.id);
    return !local || local.snippet !== thread.snippet;
  });

  await Promise.all(
    threadsToSync.map((thread) =>
      limit(async () => {
        const local = existingMap.get(thread.id);
        const isNew = !local;
        const full = await gmail.getThread(auth, thread.id);
        await queries.upsertEmailThread(userId, toThreadRecord(full, thread.snippet));
        await queries.upsertEmailMessages(userId, toMessageRecords(full.messages));
        isNew ? newCount++ : updatedCount++;
      }),
    ),
  );

  return { new: newCount, updated: updatedCount };
}

export async function search(userId: string, query: string, maxResults?: number) {
  const auth = await withUserTokens(userId);
  const resultLimit = Math.min(maxResults ?? BATCH_SIZE, BATCH_SIZE);
  const gmailThreads = await gmail.searchThreads(auth, query, resultLimit);

  await Promise.all(
    gmailThreads.map((thread) =>
      limit(async () => {
        const full = await gmail.getThread(auth, thread.id);
        await queries.upsertEmailThread(userId, toThreadRecord(full, thread.snippet));
        await queries.upsertEmailMessages(userId, toMessageRecords(full.messages));
      }),
    ),
  );

  const gmailIds = gmailThreads.map((t) => t.id);
  return queries.listEmailThreadsByGmailIds(userId, gmailIds);
}

export async function getThread(userId: string, gmailThreadId: string) {
  const cached = await queries.getEmailThread(userId, gmailThreadId);
  if (cached && cached.messages.length > 0) {
    return cached;
  }
  const auth = await withUserTokens(userId);
  const full = await gmail.getThread(auth, gmailThreadId);
  await queries.upsertEmailThread(userId, toThreadRecord(full));
  await queries.upsertEmailMessages(userId, toMessageRecords(full.messages));
  return queries.getEmailThread(userId, gmailThreadId);
}

export async function getUnbucketedThreads(userId: string) {
  const threads = await queries.getUnbucketedThreads(userId, BATCH_SIZE);
  return { unbucketed: threads.length, threads };
}

export async function sendMessage(
  userId: string,
  to: string,
  subject: string,
  body: string,
  opts?: { cc?: string[] },
) {
  const auth = await withUserTokens(userId);
  await gmail.sendMessage(auth, to, subject, body, opts);
}

export async function replyToThread(
  userId: string,
  threadId: string,
  messageId: string,
  body: string,
) {
  const auth = await withUserTokens(userId);
  await gmail.replyToThread(auth, threadId, messageId, body);
  const full = await gmail.getThread(auth, threadId);
  await queries.upsertEmailThread(userId, toThreadRecord(full));
  await queries.upsertEmailMessages(userId, toMessageRecords(full.messages));
}

export async function createDraft(
  userId: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string,
) {
  const auth = await withUserTokens(userId);
  const draftId = await gmail.createDraft(auth, to, subject, body, threadId);
  return draftId;
}

export async function trashThread(userId: string, gmailThreadId: string) {
  const auth = await withUserTokens(userId);
  await gmail.trashThread(auth, gmailThreadId);
  await queries.unassignThread(userId, gmailThreadId);
}

export async function markAsRead(userId: string, messageId: string) {
  const auth = await withUserTokens(userId);
  await gmail.markAsRead(auth, messageId);
}
