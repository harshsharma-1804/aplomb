import type { Request, Response, NextFunction } from "express";

/**
 * Centralised Express error handler.
 * Must be the LAST app.use() call in index.ts.
 * Never logs request/response bodies — they may contain patient data.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";

  console.error(`[error] ${req.method} ${req.path} → ${status} ${code}: ${message}`);

  if (res.headersSent) return;

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : message,
    code,
  });
}
