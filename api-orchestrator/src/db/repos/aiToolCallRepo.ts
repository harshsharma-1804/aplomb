import { desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ai_tool_calls } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

export type ToolCallOutcome = "ok" | "tool_error" | "scope_violation" | "denied";

export type ToolCallRecord = {
  bot_id?: string | null;
  bot_name?: string;
  user_id?: string;
  tool_name: string;
  tool_args?: unknown;
  outcome: ToolCallOutcome;
  detail?: string;
  latency_ms?: number;
};

export const aiToolCallRepo = {
  record(db: DrizzleDb, entry: ToolCallRecord) {
    db.insert(ai_tool_calls).values({
      id:         randomUUID(),
      bot_id:     entry.bot_id ?? null,
      bot_name:   entry.bot_name ?? "",
      user_id:    entry.user_id ?? "",
      tool_name:  entry.tool_name,
      tool_args:  JSON.stringify(entry.tool_args ?? {}),
      outcome:    entry.outcome,
      detail:     entry.detail ?? "",
      latency_ms: entry.latency_ms ?? 0,
      created_at: now(),
    }).run();
  },

  recent(db: DrizzleDb, limit = 100) {
    return db.select().from(ai_tool_calls)
      .orderBy(desc(ai_tool_calls.created_at))
      .limit(limit)
      .all()
      .map(r => ({
        ...r,
        _id: r.id,
        tool_args: JSON.parse(r.tool_args ?? "{}"),
      }));
  },
};
