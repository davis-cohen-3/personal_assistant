import pLimit from "p-limit";
import * as queries from "./db/queries.js";
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

export async function syncInbox(maxResults?: number): Promise<{ new: number; updated: number }> {
  const syncLimit = maxResults ?? DEFAULT_SYNC_LIMIT;
  const gmailThreads = await gmail.searchThreads("is:inbox", syncLimit);

  const gmailIds = gmailThreads.map((t) => t.id);
  const existing = await queries.listEmailThreadsByGmailIds(gmailIds);
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
        const full = await gmail.getThread(thread.id);
        await queries.upsertEmailThread(toThreadRecord(full, thread.snippet));
        await queries.upsertEmailMessages(toMessageRecords(full.messages));
        isNew ? newCount++ : updatedCount++;
      }),
    ),
  );

  return { new: newCount, updated: updatedCount };
}

export async function search(query: string, maxResults?: number) {
  const resultLimit = Math.min(maxResults ?? BATCH_SIZE, BATCH_SIZE);
  const gmailThreads = await gmail.searchThreads(query, resultLimit);

  await Promise.all(
    gmailThreads.map((thread) =>
      limit(async () => {
        const full = await gmail.getThread(thread.id);
        await queries.upsertEmailThread(toThreadRecord(full, thread.snippet));
        await queries.upsertEmailMessages(toMessageRecords(full.messages));
      }),
    ),
  );

  const gmailIds = gmailThreads.map((t) => t.id);
  return queries.listEmailThreadsByGmailIds(gmailIds);
}

export async function getThread(gmailThreadId: string) {
  const full = await gmail.getThread(gmailThreadId);
  await queries.upsertEmailThread(toThreadRecord(full));
  await queries.upsertEmailMessages(toMessageRecords(full.messages));
  return queries.getEmailThread(gmailThreadId);
}

export async function getUnbucketedThreads() {
  const threads = await queries.getUnbucketedThreads(BATCH_SIZE);
  return { unbucketed: threads.length, threads };
}

export async function sendMessage(
  to: string,
  subject: string,
  body: string,
  opts?: { cc?: string[] },
) {
  return gmail.sendMessage(to, subject, body, opts);
}

export async function replyToThread(threadId: string, messageId: string, body: string) {
  return gmail.replyToThread(threadId, messageId, body);
}

export async function createDraft(to: string, subject: string, body: string, threadId?: string) {
  return gmail.createDraft(to, subject, body, threadId);
}

export async function archiveThread(gmailThreadId: string) {
  await gmail.archiveThread(gmailThreadId);
}

export async function markAsRead(messageId: string) {
  await gmail.markAsRead(messageId);
}
