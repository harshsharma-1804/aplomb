import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env["DB_PATH"] ?? "./data/orchestrator.db";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (!_db) throw new Error("[db] Database not initialised — call initDb() first");
  return _db;
}

export async function initDb(): Promise<void> {
  if (DB_PATH !== ":memory:") {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }

  _sqlite = new Database(DB_PATH);

  // WAL mode — allows concurrent reads while a write is in progress
  _sqlite.pragma("journal_mode = WAL");
  // Enforce foreign key constraints
  _sqlite.pragma("foreign_keys = ON");

  _db = drizzle(_sqlite, { schema });

  const migrationsFolder = new URL("./migrations", import.meta.url).pathname;
  migrate(_db, { migrationsFolder });

  console.log(`[db] SQLite initialised: ${DB_PATH}`);
}

export function closeDb(): void {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
  console.log("[db] SQLite connection closed");
}

// For tests — create an in-memory instance without running migrations from disk
export function initTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return db;
}
