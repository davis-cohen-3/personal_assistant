CREATE TABLE "bucket_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"buckets" jsonb NOT NULL,
	CONSTRAINT "bucket_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buckets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"sdk_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"from_email" text,
	"from_name" text,
	"to_emails" jsonb,
	"cc_emails" jsonb,
	"subject" text,
	"body_text" text,
	"received_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text,
	"snippet" text,
	"from_email" text,
	"from_name" text,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 1 NOT NULL,
	"label_ids" jsonb,
	"gmail_history_id" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scope" text NOT NULL,
	"token_type" text NOT NULL,
	"expiry_date" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"bucket_id" uuid NOT NULL,
	"subject" text,
	"snippet" text,
	"needs_rebucket" boolean DEFAULT false NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_threads_gmail_thread_id_idx" ON "email_threads" USING btree ("gmail_thread_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_gmail_thread_id_email_threads_gmail_thread_id_fk" FOREIGN KEY ("gmail_thread_id") REFERENCES "public"."email_threads"("gmail_thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_buckets" ADD CONSTRAINT "thread_buckets_gmail_thread_id_email_threads_gmail_thread_id_fk" FOREIGN KEY ("gmail_thread_id") REFERENCES "public"."email_threads"("gmail_thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_buckets" ADD CONSTRAINT "thread_buckets_bucket_id_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_gmail_message_id_idx" ON "email_messages" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_messages_thread_idx" ON "email_messages" USING btree ("gmail_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_buckets_gmail_thread_id_idx" ON "thread_buckets" USING btree ("gmail_thread_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
INSERT INTO "bucket_templates" ("name", "description", "buckets") VALUES
(
  'Executive',
  'For leaders managing cross-functional communication, reports, and strategic decisions',
  '[
    {"name": "Needs Response", "description": "Threads requiring a reply from me — questions, approvals, or decisions only I can make", "sort_order": 0},
    {"name": "FYI / Updates", "description": "Status updates, newsletters, and announcements — read but no action needed", "sort_order": 1},
    {"name": "Delegated", "description": "Threads I''ve forwarded or assigned to someone else — track but don''t act", "sort_order": 2},
    {"name": "Scheduling", "description": "Meeting requests, calendar changes, and logistics", "sort_order": 3},
    {"name": "Low Priority", "description": "Non-urgent threads that can wait — internal FYIs, optional reads", "sort_order": 4}
  ]'
),
(
  'Sales',
  'For sales professionals managing deals, prospects, and customer relationships',
  '[
    {"name": "Hot Deals", "description": "Active opportunities with near-term close dates or pending proposals", "sort_order": 0},
    {"name": "New Leads", "description": "Inbound inquiries, introductions, and first-touch outreach", "sort_order": 1},
    {"name": "Follow-ups", "description": "Threads where I owe a response or need to check in", "sort_order": 2},
    {"name": "Internal", "description": "Team updates, CRM notifications, and internal coordination", "sort_order": 3},
    {"name": "Nurture", "description": "Long-term prospects and relationship maintenance — no immediate action", "sort_order": 4}
  ]'
),
(
  'Engineering',
  'For engineers managing code reviews, incidents, and project communication',
  '[
    {"name": "Review Requested", "description": "PRs, design docs, and RFCs awaiting my review", "sort_order": 0},
    {"name": "Blocked / Urgent", "description": "Incidents, blockers, and threads that need immediate attention", "sort_order": 1},
    {"name": "Project Updates", "description": "Sprint updates, standups, and project-level communication", "sort_order": 2},
    {"name": "CI / Alerts", "description": "Build failures, monitoring alerts, and automated notifications", "sort_order": 3},
    {"name": "General", "description": "Everything else — team chat, social, non-urgent", "sort_order": 4}
  ]'
);
