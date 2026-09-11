CREATE TABLE "bot_dashboard_requests" (
	"guild_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_dashboard_requests_unique" ON "bot_dashboard_requests" USING btree ("guild_id","request_key");