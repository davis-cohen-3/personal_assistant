-- Add user_id to email_messages (nullable for backfill)
ALTER TABLE "email_messages" ADD COLUMN "user_id" uuid;
--> statement-breakpoint

-- Backfill email_messages.user_id from email_threads
UPDATE "email_messages" em
SET user_id = et.user_id
FROM "email_threads" et
WHERE em.gmail_thread_id = et.gmail_thread_id;
--> statement-breakpoint

ALTER TABLE "email_messages" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Add user_id to thread_buckets (nullable for backfill)
ALTER TABLE "thread_buckets" ADD COLUMN "user_id" uuid;
--> statement-breakpoint

-- Backfill thread_buckets.user_id from buckets
UPDATE "thread_buckets" tb
SET user_id = b.user_id
FROM "buckets" b
WHERE tb.bucket_id = b.id;
--> statement-breakpoint

ALTER TABLE "thread_buckets" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "thread_buckets" ADD CONSTRAINT "thread_buckets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Drop old FKs that reference single-column unique on email_threads.gmail_thread_id
ALTER TABLE "email_messages"
  DROP CONSTRAINT "email_messages_gmail_thread_id_email_threads_gmail_thread_id_fk";
--> statement-breakpoint
ALTER TABLE "thread_buckets"
  DROP CONSTRAINT "thread_buckets_gmail_thread_id_email_threads_gmail_thread_id_fk";
--> statement-breakpoint

-- Now safe to replace email_threads unique index
DROP INDEX "email_threads_gmail_thread_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_user_gmail_thread_idx"
  ON "email_threads" USING btree ("user_id", "gmail_thread_id");
--> statement-breakpoint

-- Replace email_messages unique index
DROP INDEX "email_messages_gmail_message_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_user_gmail_message_id_idx"
  ON "email_messages" USING btree ("user_id", "gmail_message_id");
--> statement-breakpoint

-- Add composite FK: email_messages → email_threads
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_thread_fk"
  FOREIGN KEY ("user_id", "gmail_thread_id")
  REFERENCES "public"."email_threads"("user_id", "gmail_thread_id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Replace thread_buckets unique index
DROP INDEX "thread_buckets_gmail_thread_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "thread_buckets_user_gmail_thread_idx"
  ON "thread_buckets" USING btree ("user_id", "gmail_thread_id");
--> statement-breakpoint

-- Add composite FK: thread_buckets → email_threads
ALTER TABLE "thread_buckets" ADD CONSTRAINT "thread_buckets_user_thread_fk"
  FOREIGN KEY ("user_id", "gmail_thread_id")
  REFERENCES "public"."email_threads"("user_id", "gmail_thread_id")
  ON DELETE cascade ON UPDATE no action;
