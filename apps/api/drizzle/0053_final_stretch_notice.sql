CREATE TABLE "project_final_stretch_notice" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"month" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_final_stretch_notice_project_month_unique" UNIQUE("project_id","month")
);
--> statement-breakpoint
ALTER TABLE "project_final_stretch_notice" ADD CONSTRAINT "project_final_stretch_notice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_final_stretch_notice_projectId_idx" ON "project_final_stretch_notice" USING btree ("project_id");