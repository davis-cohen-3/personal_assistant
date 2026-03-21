import { type gmail_v1, google } from "googleapis";
import { createMimeMessage } from "mimetext";
import { AppError } from "../exceptions.js";
import { getAuthClient } from "./auth.js";

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
}

export interface ThreadSummary {
  id: string;
  snippet?: string;
  historyId?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  data: Buffer | string; // Buffer is converted to base64; string is assumed already base64
}

export interface SendMessageOptions {
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined | null,
  name: string,
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function findBodyPart(payload: gmail_v1.Schema$MessagePart, mimeType: string): string {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findBodyPart(part, mimeType);
      if (found) return found;
    }
  }
  return "";
}

function decodeMessage(data: gmail_v1.Schema$Message): GmailMessage {
  const headers = data.payload?.headers;
  const payload = data.payload ?? {};

  let bodyText = "";
  let bodyHtml = "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    bodyText = decodeBase64Url(payload.body.data);
  } else if (payload.mimeType === "text/html" && payload.body?.data) {
    bodyHtml = decodeBase64Url(payload.body.data);
  } else if (payload.parts) {
    bodyText = findBodyPart(payload, "text/plain");
    bodyHtml = findBodyPart(payload, "text/html");
  }

  return {
    id: data.id ?? "",
    threadId: data.threadId ?? "",
    labelIds: data.labelIds ?? [],
    snippet: data.snippet ?? "",
    internalDate: data.internalDate ?? "",
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    date: getHeader(headers, "Date"),
    bodyText,
    bodyHtml,
  };
}

function toBase64(data: Buffer | string): string {
  return Buffer.isBuffer(data) ? data.toString("base64") : data;
}

async function getSenderEmail(): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new AppError("Could not determine sender email from profile", 500);
  return email;
}

export async function getMessage(id: string): Promise<GmailMessage> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  return decodeMessage(res.data);
}

export async function getThread(id: string): Promise<GmailThread> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const res = await gmail.users.threads.get({ userId: "me", id, format: "full" });
  const messages = (res.data.messages ?? []).map(decodeMessage);
  return { id: res.data.id ?? id, messages };
}

export async function searchThreads(query: string, maxResults: number): Promise<ThreadSummary[]> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const res = await gmail.users.threads.list({ userId: "me", q: query, maxResults });
  return (res.data.threads ?? []).map((t) => ({
    id: t.id ?? "",
    snippet: t.snippet ?? undefined,
    historyId: t.historyId ?? undefined,
  }));
}

export async function sendMessage(
  to: string,
  subject: string,
  body: string,
  opts?: SendMessageOptions,
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const from = await getSenderEmail();

  const msg = createMimeMessage();
  msg.setSender({ addr: from });
  msg.setRecipient(to);
  if (opts?.cc) {
    for (const addr of opts.cc) msg.setRecipient(addr, { type: "Cc" });
  }
  if (opts?.bcc) {
    for (const addr of opts.bcc) msg.setRecipient(addr, { type: "Bcc" });
  }
  msg.setSubject(subject);
  msg.addMessage({ contentType: "text/plain", data: body });
  if (opts?.attachments) {
    for (const att of opts.attachments) {
      msg.addAttachment({
        filename: att.filename,
        contentType: att.contentType,
        data: toBase64(att.data),
      });
    }
  }

  await gmail.users.messages.send({ userId: "me", requestBody: { raw: msg.asEncoded() } });
}

export async function replyToThread(
  threadId: string,
  messageId: string,
  body: string,
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });

  const original = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
  });
  const origHeaders = original.data.payload?.headers;
  const rfcMessageId = getHeader(origHeaders, "Message-ID");
  const originalFrom = getHeader(origHeaders, "From");
  const originalSubject = getHeader(origHeaders, "Subject");
  const replySubject = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const from = await getSenderEmail();

  const msg = createMimeMessage();
  msg.setSender({ addr: from });
  msg.setRecipient(originalFrom);
  msg.setSubject(replySubject);
  if (rfcMessageId) {
    msg.setHeader("In-Reply-To", rfcMessageId);
    msg.setHeader("References", rfcMessageId);
  }
  msg.addMessage({ contentType: "text/plain", data: body });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: msg.asEncoded(), threadId },
  });
}

export async function createDraft(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  opts?: { attachments?: EmailAttachment[] },
): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const from = await getSenderEmail();

  const msg = createMimeMessage();
  msg.setSender({ addr: from });
  msg.setRecipient(to);
  msg.setSubject(subject);
  msg.addMessage({ contentType: "text/plain", data: body });
  if (opts?.attachments) {
    for (const att of opts.attachments) {
      msg.addAttachment({
        filename: att.filename,
        contentType: att.contentType,
        data: toBase64(att.data),
      });
    }
  }

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw: msg.asEncoded(), ...(threadId ? { threadId } : {}) },
    },
  });

  const draftId = res.data.id;
  if (!draftId) throw new AppError("Draft created but no ID returned", 500);
  return draftId;
}

export async function modifyLabels(id: string, add: string[], remove: string[]): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { addLabelIds: add, removeLabelIds: remove },
  });
}

export async function markAsRead(id: string): Promise<void> {
  return modifyLabels(id, [], ["UNREAD"]);
}

export async function archiveThread(threadId: string): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  await gmail.users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: { removeLabelIds: ["INBOX"] },
  });
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export async function listLabels(): Promise<GmailLabel[]> {
  const gmail = google.gmail({ version: "v1", auth: getAuthClient() });
  const res = await gmail.users.labels.list({ userId: "me" });
  return (res.data.labels ?? []).map((l) => ({
    id: l.id ?? "",
    name: l.name ?? "",
    type: l.type ?? undefined,
  }));
}
