ALTER TABLE "asset" ADD COLUMN "folder_label" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "undone_at" timestamp;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "undone_by" text;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_undone_by_user_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;