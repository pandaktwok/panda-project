CREATE TABLE "project_installment" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"number" integer NOT NULL,
	"due_date" date NOT NULL,
	"expected_cents" bigint NOT NULL,
	"paid_at" date,
	"paid_cents" bigint,
	"paid_by" text,
	"file_asset_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_installment_line_number_unique" UNIQUE("line_id","number")
);
--> statement-breakpoint
CREATE TABLE "project_payment_line" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tag_id" text,
	"supplier" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"installments_count" integer NOT NULL,
	"first_due_date" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_tag_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "finance_total_cents" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "finance_months" integer;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "finance_first_due_date" date;--> statement-breakpoint
ALTER TABLE "project_installment" ADD CONSTRAINT "project_installment_line_id_project_payment_line_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."project_payment_line"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_installment" ADD CONSTRAINT "project_installment_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_installment" ADD CONSTRAINT "project_installment_file_asset_id_asset_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_payment_line" ADD CONSTRAINT "project_payment_line_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_payment_line" ADD CONSTRAINT "project_payment_line_tag_id_project_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."project_tag"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_tag" ADD CONSTRAINT "project_tag_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_installment_lineId_idx" ON "project_installment" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "project_installment_dueDate_idx" ON "project_installment" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "project_installment_fileAssetId_idx" ON "project_installment" USING btree ("file_asset_id");--> statement-breakpoint
CREATE INDEX "project_payment_line_projectId_idx" ON "project_payment_line" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_payment_line_tagId_idx" ON "project_payment_line" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "project_tag_projectId_idx" ON "project_tag" USING btree ("project_id");