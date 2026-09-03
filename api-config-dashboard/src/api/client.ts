/**
 * Typed API client for the orchestrator config API.
 * All requests go through /__config/* or /auth/* — proxied by nginx (prod)
 * or vite dev server (local).
 * Cookies are always included (credentials: "include").
 * On 401, dispatches a "dashboard:unauthenticated" event so SessionContext
 * can redirect to login.
 */

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("dashboard:unauthenticated"));
    throw new Error("Session expired — please log in again");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:  <T>(path: string)               => request<T>("GET",    path),
  post: <T>(path: string, body: unknown) => request<T>("POST",   path, body),
  put:  <T>(path: string, body: unknown) => request<T>("PUT",    path, body),
  del:  <T>(path: string)               => request<T>("DELETE",  path),
};
