import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatar_url: text("avatar_url"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const buckets = pgTable(
  "buckets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("buckets_user_id_name_idx").on(table.user_id, table.name)],
);

// Pre-defined starter bucket sets; user picks one on first launch.
export const bucketTemplates = pgTable("bucket_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  buckets: jsonb("buckets").notNull(), // Array<{ name, description, sort_order }>
});

// One row per user — keyed by user_id instead of fixed 'primary'.
export const googleTokens = pgTable("google_tokens", {
  user_id: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token").notNull(),
  scope: text("scope").notNull(),
  token_type: text("token_type").notNull(),
  // googleapis returns expiry_date as epoch ms — convert with new Date() before upserting
  expiry_date: timestamp("expiry_date", { withTimezone: true }).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Local cache of Gmail threads.
export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    gmail_thread_id: text("gmail_thread_id").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    from_email: text("from_email"),
    from_name: text("from_name"),
    last_message_at: timestamp("last_message_at", { withTimezone: true }),
    message_count: integer("message_count").notNull().default(1),
    label_ids: jsonb("label_ids"),
    gmail_history_id: text("gmail_history_id"),
    synced_at: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_threads_user_gmail_thread_idx").on(table.user_id, table.gmail_thread_id),
  ],
);

// Individual messages within threads.
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    gmail_message_id: text("gmail_message_id").notNull(),
    gmail_thread_id: text("gmail_thread_id").notNull(),
    from_email: text("from_email"),
    from_name: text("from_name"),
    to_emails: jsonb("to_emails"), // string[]
    cc_emails: jsonb("cc_emails"), // string[]
    subject: text("subject"),
    body_text: text("body_text"), // plain text, truncated to 2000 chars
    received_at: timestamp("received_at", { withTimezone: true }).notNull(),
    synced_at: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("email_messages_user_gmail_message_id_idx").on(
      table.user_id,
      table.gmail_message_id,
    ),
    index("email_messages_thread_idx").on(table.gmail_thread_id),
    foreignKey({
      columns: [table.user_id, table.gmail_thread_id],
      foreignColumns: [emailThreads.user_id, emailThreads.gmail_thread_id],
    }).onDelete("cascade"),
  ],
);

export const threadBuckets = pgTable(
  "thread_buckets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    gmail_thread_id: text("gmail_thread_id").notNull(),
    bucket_id: uuid("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    subject: text("subject"),
    snippet: text("snippet"),
    needs_rebucket: boolean("needs_rebucket").notNull().default(false),
    assigned_at: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("thread_buckets_user_gmail_thread_idx").on(table.user_id, table.gmail_thread_id),
    foreignKey({
      columns: [table.user_id, table.gmail_thread_id],
      foreignColumns: [emailThreads.user_id, emailThreads.gmail_thread_id],
    }).onDelete("cascade"),
  ],
);

// Each conversation maps to one Agent SDK session.
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  sdk_session_id: text("sdk_session_id"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Durable message log for UI display.
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversation_id: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
