CREATE TABLE "google_drive_config" (
	"id" text PRIMARY KEY DEFAULT 'instance' NOT NULL,
	"client_id" text,
	"client_secret_enc" text,
	"refresh_token_enc" text,
	"account_email" text,
	"root_folder_id" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp,
	"connected_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_drive_copy" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"drive_file_id" text,
	"drive_folder_id" text,
	"copied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_drive_copy_asset_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "google_drive_folder" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"root_folder_id" text NOT NULL,
	"drive_folder_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "google_drive_folder_root_key_unique" UNIQUE("root_folder_id","key")
);
--> statement-breakpoint
ALTER TABLE "google_drive_config" ADD CONSTRAINT "google_drive_config_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "google_drive_copy" ADD CONSTRAINT "google_drive_copy_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "google_drive_copy_status_next_idx" ON "google_drive_copy" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "google_drive_copy_project_idx" ON "google_drive_copy" USING btree ("project_id");