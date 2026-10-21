import { createHash } from "crypto";

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

export function initLogger(): void {
  console.log("[logger] SQLite-mode: request logs written to stdout only");
}

export function hashSub(sub: string): string {
  return createHash("sha256").update(sub).digest("hex");
}

export function writeLog(entry: RequestLogEntry): void {
  if (process.env["LOG_REQUESTS"] === "true") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
  }
}
