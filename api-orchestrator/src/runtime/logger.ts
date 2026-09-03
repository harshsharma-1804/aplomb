import { createHash } from "crypto";
import mongoose from "mongoose";
import { config } from "../config/appConfig.js";

const LOG_COLLECTION = "request_logs";

export function initLogger(): void {
  mongoose.connection.once("open", () => {
    const db = mongoose.connection.db;
    if (!db) return;
    db.createCollection(LOG_COLLECTION, {
      timeseries: { timeField: "ts", granularity: "seconds" },
      expireAfterSeconds: config.telemetry.logRetentionSeconds,
    }).catch(() => {});
  });
}

export interface RequestLogEntry {
  app: string;
  endpoint_path: string;
  method: string;
  upstream_latency_ms: number;
  total_latency_ms: number;
  status: number;
  transform_outcome: "ok" | "warning" | "error" | "skipped";
  provider_issuer: string | null;
  sub_hash: string | null;
  request_body_size: number;
  response_body_size: number;
  input_validation_result: "passed" | "failed" | "skipped";
  output_warning_count: number;
}

export function hashSub(sub: string): string {
  return createHash("sha256").update(sub).digest("hex");
}

export function writeLog(entry: RequestLogEntry): void {
  const db = mongoose.connection.db;
  if (!db) return;
  db.collection(LOG_COLLECTION).insertOne({ ts: new Date(), ...entry }).catch((err) => {
    console.error("[logger] Failed to write log:", err);
  });
}
