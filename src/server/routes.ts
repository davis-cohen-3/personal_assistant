import { Hono } from "hono";
import { z } from "zod";
import * as bucketOps from "./buckets.js";
import * as queries from "./db/queries.js";
import * as email from "./email.js";
import type { AppEnv } from "./env.js";
import { withUserTokens } from "./google/auth.js";
import * as calendar from "./google/calendar.js";

export const apiRoutes = new Hono<AppEnv>();

apiRoutes.use("*", async (c, next) => {
  console.info(`→ ${c.req.method} ${c.req.path}`);
  await next();
  console.info(`← ${c.req.method} ${c.req.path} ${c.res.status}`);
});

const sendEmailSchema = z.object({
  to: z.string().email(),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

const replySchema = z.object({
  body: z.string().min(1),
  messageId: z.string().min(1),
});

const createEventSchema = z.object({
  summary: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  attendees: z.array(z.string().email()).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
});

const updateEventSchema = createEventSchema.partial();

const createBucketSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const updateBucketSchema = createBucketSchema.partial().extend({
  sort_order: z.number().int().optional(),
});

const assignThreadSchema = z.object({
  gmail_thread_id: z.string().min(1),
  bucket_id: z.string().uuid(),
  subject: z.string().optional(),
  snippet: z.string().optional(),
});

const createConversationSchema = z.object({
  title: z.string().min(1).optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1),
});

const gmailThreadsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  maxResults: z.coerce.number().int().min(1).max(25).optional(),
});

const calendarEventsQuerySchema = z.object({
  timeMin: z.string().datetime().optional(),
  timeMax: z.string().datetime().optional(),
  maxResults: z.coerce.number().int().min(1).max(25).optional(),
});

apiRoutes.post("/gmail/sync", async (c) => {
  const userId = c.get("userId") as string;
  const result = await email.syncInbox(userId, 25);
  return c.json(result);
});

apiRoutes.get("/gmail/threads", async (c) => {
  const userId = c.get("userId") as string;
  const rawQuery = {
    q: c.req.query("q"),
    maxResults: c.req.query("maxResults"),
  };
  const queryParams = gmailThreadsQuerySchema.parse(rawQuery);

  const q = queryParams.q ?? "is:inbox";
  const maxResults = queryParams.maxResults ?? 25;
  const threads = await email.search(userId, q, maxResults);
  return c.json(threads);
});

apiRoutes.get("/gmail/threads/:id", async (c) => {
  const userId = c.get("userId") as string;
  const thread = await email.getThread(userId, c.req.param("id"));
  return c.json(thread);
});

apiRoutes.post("/gmail/send", async (c) => {
  const userId = c.get("userId") as string;
  const body = sendEmailSchema.parse(await c.req.json());
  const result = await email.sendMessage(userId, body.to, body.subject, body.body, {
    cc: body.cc,
  });
  return c.json(result, 201);
});

apiRoutes.post("/gmail/threads/:id/reply", async (c) => {
  const userId = c.get("userId") as string;
  const body = replySchema.parse(await c.req.json());
  const result = await email.replyToThread(userId, c.req.param("id"), body.messageId, body.body);
  return c.json(result, 201);
});

apiRoutes.post("/gmail/threads/:id/trash", async (c) => {
  const userId = c.get("userId") as string;
  await email.trashThread(userId, c.req.param("id"));
  return c.json({ ok: true });
});

apiRoutes.post("/gmail/messages/:id/read", async (c) => {
  const userId = c.get("userId") as string;
  await email.markAsRead(userId, c.req.param("id"));
  return c.json({ ok: true });
});

apiRoutes.get("/calendar/events", async (c) => {
  const userId = c.get("userId") as string;
  const auth = await withUserTokens(userId);
  const rawQuery = {
    timeMin: c.req.query("timeMin"),
    timeMax: c.req.query("timeMax"),
    maxResults: c.req.query("maxResults"),
  };
  const queryParams = calendarEventsQuerySchema.parse(rawQuery);

  const timeMin = queryParams.timeMin ?? new Date().toISOString();
  const now = new Date();
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const timeMax = queryParams.timeMax ?? endOfDay.toISOString();
  const maxResults = queryParams.maxResults ?? 25;
  const events = await calendar.listEvents(auth, timeMin, timeMax, { maxResults });
  return c.json(events);
});

apiRoutes.get("/calendar/events/:id", async (c) => {
  const userId = c.get("userId") as string;
  const auth = await withUserTokens(userId);
  const event = await calendar.getEvent(auth, c.req.param("id"));
  return c.json(event);
});

apiRoutes.post("/calendar/events", async (c) => {
  const userId = c.get("userId") as string;
  const auth = await withUserTokens(userId);
  const body = createEventSchema.parse(await c.req.json());
  const event = await calendar.createEvent(auth, body);
  return c.json(event, 201);
});

apiRoutes.patch("/calendar/events/:id", async (c) => {
  const userId = c.get("userId") as string;
  const auth = await withUserTokens(userId);
  const body = updateEventSchema.parse(await c.req.json());
  const event = await calendar.updateEvent(auth, c.req.param("id"), body);
  return c.json(event);
});

apiRoutes.delete("/calendar/events/:id", async (c) => {
  const userId = c.get("userId") as string;
  const auth = await withUserTokens(userId);
  await calendar.deleteEvent(auth, c.req.param("id"));
  return c.json({ ok: true });
});

apiRoutes.get("/buckets", async (c) => {
  const userId = c.get("userId") as string;
  const buckets = await queries.listBucketsWithThreads(userId);
  return c.json(buckets);
});

apiRoutes.post("/buckets", async (c) => {
  const userId = c.get("userId") as string;
  const body = createBucketSchema.parse(await c.req.json());
  const bucket = await bucketOps.createBucket(userId, body.name, body.description);
  return c.json({ ...bucket, rebucket_required: true }, 201);
});

// /buckets/assign must be registered before /buckets/:id
apiRoutes.post("/buckets/assign", async (c) => {
  const userId = c.get("userId") as string;
  const body = assignThreadSchema.parse(await c.req.json());
  await bucketOps.assignThread(
    userId,
    body.gmail_thread_id,
    body.bucket_id,
    body.subject,
    body.snippet,
  );
  return c.json({ ok: true });
});

apiRoutes.patch("/buckets/:id", async (c) => {
  const userId = c.get("userId") as string;
  const body = updateBucketSchema.parse(await c.req.json());
  const bucket = await queries.updateBucket(userId, c.req.param("id"), body);
  return c.json(bucket);
});

apiRoutes.delete("/buckets/:id", async (c) => {
  const userId = c.get("userId") as string;
  await queries.deleteBucket(userId, c.req.param("id"));
  return c.json({ ok: true });
});

apiRoutes.get("/bucket-templates", async (c) => {
  const templates = await queries.listBucketTemplates();
  return c.json(templates);
});

apiRoutes.get("/bucket-templates/:id", async (c) => {
  const template = await queries.getBucketTemplate(c.req.param("id"));
  if (!template) return c.json({ error: "Bucket template not found" }, 404);
  return c.json(template);
});

apiRoutes.post("/bucket-templates/:id/apply", async (c) => {
  const userId = c.get("userId") as string;
  const result = await bucketOps.applyBucketTemplate(userId, c.req.param("id"));
  return c.json(result, 201);
});

apiRoutes.get("/conversations", async (c) => {
  const userId = c.get("userId") as string;
  const conversations = await queries.listConversations(userId);
  return c.json(conversations);
});

apiRoutes.post("/conversations", async (c) => {
  const userId = c.get("userId") as string;
  const body = createConversationSchema.parse(await c.req.json());
  const conversation = await queries.createConversation(userId, body.title ?? "New conversation");
  return c.json(conversation, 201);
});

apiRoutes.get("/conversations/:id", async (c) => {
  const userId = c.get("userId") as string;
  const conversation = await queries.getConversation(userId, c.req.param("id"));
  if (!conversation) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  const messages = await queries.listMessagesByConversation(userId, c.req.param("id"));
  return c.json({ ...conversation, messages });
});

apiRoutes.patch("/conversations/:id", async (c) => {
  const userId = c.get("userId") as string;
  const body = updateConversationSchema.parse(await c.req.json());
  const conversation = await queries.updateConversation(userId, c.req.param("id"), {
    title: body.title,
  });
  return c.json(conversation);
});

apiRoutes.delete("/conversations/:id", async (c) => {
  const userId = c.get("userId") as string;
  await queries.deleteConversation(userId, c.req.param("id"));
  return c.json({ ok: true });
});
