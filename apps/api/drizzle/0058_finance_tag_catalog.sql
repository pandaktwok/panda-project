CREATE TABLE "finance_tag_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_tag_catalog_workspace_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "finance_tag_catalog" ADD CONSTRAINT "finance_tag_catalog_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "finance_tag_catalog_workspaceId_idx" ON "finance_tag_catalog" USING btree ("workspace_id");