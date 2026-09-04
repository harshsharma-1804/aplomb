import type { drizzle } from "drizzle-orm/better-sqlite3";
import type * as schema from "../schema.js";

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;
