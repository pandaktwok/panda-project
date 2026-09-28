CREATE TABLE "ai_action_log" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"connection_name" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"authorized_by_user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"can_pay" boolean DEFAULT true NOT NULL,
	"can_edit" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "ai_connection_session_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_connection_id_ai_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connection"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_action_log" ADD CONSTRAINT "ai_action_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ai_connection" ADD CONSTRAINT "ai_connection_authorized_by_user_id_user_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ai_action_log_createdAt_idx" ON "ai_action_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_action_log_connection_idx" ON "ai_action_log" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "ai_connection_authorizedBy_idx" ON "ai_connection" USING btree ("authorized_by_user_id");