CREATE TABLE "project_member_access" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_pay" boolean DEFAULT true NOT NULL,
	"can_attach" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_access_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_member_access" ADD CONSTRAINT "project_member_access_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_member_access" ADD CONSTRAINT "project_member_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_member_access" ADD CONSTRAINT "project_member_access_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_member_access_userId_idx" ON "project_member_access" USING btree ("user_id");