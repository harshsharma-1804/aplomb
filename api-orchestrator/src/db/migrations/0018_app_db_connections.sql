-- Named DB connection registry per app.
-- Stores connection type, host, database name, and a reference to the Secrets
-- vault for the password/auth-string. The full connection URL is assembled at
-- runtime by the orchestrator — credentials are never stored in plaintext.

CREATE TABLE `app_db_connections` (
  `id`          text PRIMARY KEY NOT NULL,
  `app_id`      text NOT NULL REFERENCES `apps`(`id`) ON DELETE CASCADE,
  `name`        text NOT NULL,
  `db_type`     text NOT NULL,   -- "mongodb" | "postgresql" | "mysql"
  `host`        text NOT NULL,   -- e.g. "localhost:27017" or "db.example.com:5432"
  `database`    text NOT NULL,   -- database / default-db name
  `username`    text,            -- optional; password always via secret_id
  `secret_id`   text,            -- secrets.id — resolved at runtime for password
  `options`     text NOT NULL DEFAULT '{}',  -- driver extra options JSON blob
  `created_by`  text,
  `created_at`  text NOT NULL,
  `updated_at`  text NOT NULL,
  UNIQUE(`app_id`, `name`)
);
