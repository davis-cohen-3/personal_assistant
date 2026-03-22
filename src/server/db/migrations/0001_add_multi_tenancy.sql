-- 1. Create users table
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

--> statement-breakpoint

-- 2. Add user_id columns as nullable first (for backfill)
ALTER TABLE "conversations" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "buckets" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "email_threads" ADD COLUMN "user_id" uuid;

--> statement-breakpoint

-- 3. Replace google_tokens: drop old table, create new one keyed by user_id
DROP TABLE "google_tokens";
--> statement-breakpoint
CREATE TABLE "google_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scope" text NOT NULL,
	"token_type" text NOT NULL,
	"expiry_date" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- 4. Backfill: create user from existing data, assign to all rows
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Only backfill if there are existing rows to migrate
  IF EXISTS (SELECT 1 FROM conversations) OR EXISTS (SELECT 1 FROM buckets) OR EXISTS (SELECT 1 FROM email_threads) THEN
    INSERT INTO users (email, name) VALUES ('backfill@localhost', 'Backfill User')
    RETURNING id INTO v_user_id;

    UPDATE conversations SET user_id = v_user_id WHERE user_id IS NULL;
    UPDATE buckets SET user_id = v_user_id WHERE user_id IS NULL;
    UPDATE email_threads SET user_id = v_user_id WHERE user_id IS NULL;
  END IF;
END $$;

--> statement-breakpoint

-- 5. Set columns to NOT NULL
ALTER TABLE "conversations" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "buckets" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_threads" ALTER COLUMN "user_id" SET NOT NULL;

--> statement-breakpoint

-- 6. Add foreign keys
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "buckets" ADD CONSTRAINT "buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_tokens" ADD CONSTRAINT "google_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint

-- 7. Replace buckets unique constraint: name → (user_id, name)
ALTER TABLE "buckets" DROP CONSTRAINT "buckets_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "buckets_user_id_name_idx" ON "buckets" USING btree ("user_id", "name");
