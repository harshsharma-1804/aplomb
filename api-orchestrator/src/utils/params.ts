/**
 * Safely extracts a string route parameter.
 * Express types params as string | string[] — this normalises to string.
 */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
