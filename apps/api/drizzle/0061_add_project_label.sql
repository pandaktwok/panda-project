CREATE TABLE "project_label" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_label_workspace_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "label_id" text;--> statement-breakpoint
ALTER TABLE "project_label" ADD CONSTRAINT "project_label_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_label_workspaceId_idx" ON "project_label" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_label_id_project_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."project_label"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_labelId_idx" ON "project" USING btree ("label_id");