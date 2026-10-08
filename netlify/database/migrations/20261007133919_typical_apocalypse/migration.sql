CREATE TYPE "campaign_status" AS ENUM('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "group_status" AS ENUM('ACTIVE', 'PAUSED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "member_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TYPE "queue_status" AS ENUM('PENDING', 'READY', 'OPENED', 'AWAITING_CONFIRMATION', 'POSTED', 'SKIPPED', 'FAILED');--> statement-breakpoint
CREATE TYPE "user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "variant_strategy" AS ENUM('PRIMARY_ONLY', 'ROUND_ROBIN');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"workspace_id" uuid,
	"action" varchar(80) NOT NULL,
	"resource_type" varchar(80),
	"resource_id" uuid,
	"metadata_json" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"campaign_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"content_id" uuid NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT'::"campaign_status" NOT NULL,
	"variant_strategy" "variant_strategy" DEFAULT 'PRIMARY_ONLY'::"variant_strategy" NOT NULL,
	"min_interval_seconds" integer DEFAULT 300 NOT NULL,
	"max_interval_seconds" integer DEFAULT 600 NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"to" varchar(320) NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"facebook_url" text NOT NULL,
	"category" varchar(80),
	"description" text,
	"notes" text,
	"status" "group_status" DEFAULT 'ACTIVE'::"group_status" NOT NULL,
	"last_posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"content_id" uuid,
	"storage_key" text NOT NULL UNIQUE,
	"mime_type" varchar(100) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"queue_item_id" uuid NOT NULL,
	"status" "queue_status" NOT NULL,
	"facebook_post_url" text,
	"notes" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid,
	"status" "queue_status" DEFAULT 'PENDING'::"queue_status" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(80),
	"error_message" text,
	"claim_token" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" varchar(320) NOT NULL UNIQUE,
	"password_hash" text,
	"display_name" varchar(120) NOT NULL,
	"avatar_url" text,
	"status" "user_status" DEFAULT 'ACTIVE'::"user_status" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'MEMBER'::"member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(120) NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_workspace_idx" ON "audit_logs" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_groups_uq" ON "campaign_groups" ("campaign_id","group_id");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_idx" ON "campaigns" ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" ("status");--> statement-breakpoint
CREATE INDEX "contents_workspace_idx" ON "contents" ("workspace_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" ("user_id");--> statement-breakpoint
CREATE INDEX "devices_workspace_idx" ON "devices" ("workspace_id");--> statement-breakpoint
CREATE INDEX "devices_token_hash_idx" ON "devices" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_workspace_url_uq" ON "groups" ("workspace_id","facebook_url");--> statement-breakpoint
CREATE INDEX "groups_workspace_idx" ON "groups" ("workspace_id");--> statement-breakpoint
CREATE INDEX "history_workspace_idx" ON "post_history" ("workspace_id");--> statement-breakpoint
CREATE INDEX "history_campaign_idx" ON "post_history" ("campaign_id");--> statement-breakpoint
CREATE INDEX "history_group_idx" ON "post_history" ("group_id");--> statement-breakpoint
CREATE INDEX "queue_workspace_idx" ON "queue_items" ("workspace_id");--> statement-breakpoint
CREATE INDEX "queue_campaign_idx" ON "queue_items" ("campaign_id");--> statement-breakpoint
CREATE INDEX "queue_status_idx" ON "queue_items" ("status");--> statement-breakpoint
CREATE INDEX "queue_scheduled_idx" ON "queue_items" ("scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_uq" ON "workspace_members" ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" ("user_id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "campaign_groups" ADD CONSTRAINT "campaign_groups_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaign_groups" ADD CONSTRAINT "campaign_groups_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_content_id_contents_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id");--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_content_id_contents_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contents" ADD CONSTRAINT "contents_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_content_id_contents_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_history" ADD CONSTRAINT "post_history_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_history" ADD CONSTRAINT "post_history_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_history" ADD CONSTRAINT "post_history_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_history" ADD CONSTRAINT "post_history_queue_item_id_queue_items_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_campaign_id_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_variant_id_content_variants_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "content_variants"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");