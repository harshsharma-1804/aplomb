import { and, eq, isNull, gt, asc, lt, or, sql } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { app_sessions, type AppSession } from "../schema.js";
import type { DrizzleDb } from "./types.js";
import type { SessionConfig } from "./appRepo.js";
import { encryptSecret } from "../../secrets/resolver.js";

/**
 * App-scoped, per-device end-user sessions (orc_sid cookies).
 * See Execution Plan/Orchestrator/Features/AppScopedSessions-9.md
 *
 * Isolation guarantees live HERE and in the runtime router:
 *   - every row is bound to one app_id — cross-app reuse is rejected by the caller
 *   - this store is disjoint from dashboard `sessions` — neither middleware reads the other's cookie
 */

export const SESSION_DEFAULTS = {
  ttl_idle_min: 30,
  max_age_min: 480,
  max_sessions_per_user: 5,
  ua_enforce: "flag" as "off" | "flag" | "enforce",
};

export function resolveSessionConfig(app: { session_config?: unknown }): Required<SessionConfig> {
  const raw = (app.session_config ?? {}) as SessionConfig;
  return {
    cookie_name: raw.cookie_name ?? "",
    ttl_idle_min: raw.ttl_idle_min ?? SESSION_DEFAULTS.ttl_idle_min,
    max_age_min: raw.max_age_min ?? SESSION_DEFAULTS.max_age_min,
    max_sessions_per_user: raw.max_sessions_per_user ?? SESSION_DEFAULTS.max_sessions_per_user,
    ua_enforce: raw.ua_enforce ?? SESSION_DEFAULTS.ua_enforce,
    login_redirect_allowlist: raw.login_redirect_allowlist ?? [],
    post_login_redirect: raw.post_login_redirect ?? "",
    link_identity_on_verified_email: raw.link_identity_on_verified_email ?? true,
    require_email_verification: raw.require_email_verification ?? true,
    twofa_available: raw.twofa_available ?? true,
  };
}

export function hashUa(ua: string): string {
  return createHash("sha256").update(ua).digest("hex");
}

/** Best-effort device label from User-Agent — no dependency, stable enough for display. */
export function deviceLabelFromUa(ua: string): string {
  const os =
    /Windows/i.test(ua) ? "Windows" :
    /iPhone|iPad/i.test(ua) ? "iOS" :
    /Android/i.test(ua) ? "Android" :
    /Mac OS X|Macintosh/i.test(ua) ? "macOS" :
    /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${browser} on ${os}`;
}

export interface MintSessionInput {
  app_id: string;
  sub: string;
  email: string | null;
  issuer: string;                    // 'gateway:<app_id>' or IdP issuer
  user_agent: string;
  ip: string | null;
  idp_token?: string | null;         // encrypted at rest, never returned
  bot_snapshot?: string[];
}

export interface SessionPrincipal {
  sessionId: string;
  appId: string;
  sub: string;
  email: string | null;
  issuer: string;
  deviceLabel: string;
  botSnapshot: string[];
  uaHash: string;
}

const now = () => new Date().toISOString();
const minsFromNow = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString();

function toPrincipal(row: AppSession): SessionPrincipal {
  return {
    sessionId: row.id,
    appId: row.app_id,
    sub: row.sub,
    email: row.email,
    issuer: row.issuer,
    deviceLabel: row.device_label,
    botSnapshot: JSON.parse(row.bot_snapshot ?? "[]"),
    uaHash: row.ua_hash,
  };
}

export const appSessionRepo = {
  /**
   * Mint a session for a verified principal. Enforces max_sessions_per_user by
   * evicting the oldest-idle session (better UX than rejecting the new login).
   */
  mint(db: DrizzleDb, input: MintSessionInput, cfg: Required<SessionConfig>): SessionPrincipal {
    const cap = Math.max(1, cfg.max_sessions_per_user);
    const active = db.select().from(app_sessions)
      .where(and(
        eq(app_sessions.app_id, input.app_id),
        eq(app_sessions.sub, input.sub),
        isNull(app_sessions.revoked_at),
        gt(app_sessions.absolute_expires_at, now()),
        gt(app_sessions.idle_expires_at, now()),
      ))
      .orderBy(asc(app_sessions.last_active_at))
      .all();
    if (active.length >= cap) {
      const toEvict = active.slice(0, active.length - cap + 1);
      for (const s of toEvict) {
        db.update(app_sessions).set({ revoked_at: now() }).where(eq(app_sessions.id, s.id)).run();
      }
    }

    const id = randomBytes(32).toString("base64url");
    const t = now();
    let idp: { ct: string; iv: string; tag: string } | null = null;
    if (input.idp_token) {
      const enc = encryptSecret(input.idp_token);
      idp = { ct: enc.ciphertext, iv: enc.iv, tag: enc.auth_tag };
    }
    db.insert(app_sessions).values({
      id,
      app_id: input.app_id,
      sub: input.sub,
      email: input.email,
      issuer: input.issuer,
      device_label: deviceLabelFromUa(input.user_agent),
      ua_hash: hashUa(input.user_agent),
      last_seen_ip: input.ip,
      idp_token_ct: idp?.ct ?? null,
      idp_token_iv: idp?.iv ?? null,
      idp_token_tag: idp?.tag ?? null,
      bot_snapshot: JSON.stringify(input.bot_snapshot ?? []),
      idle_expires_at: minsFromNow(cfg.ttl_idle_min),
      absolute_expires_at: minsFromNow(cfg.max_age_min),
      last_active_at: t,
      created_at: t,
    }).run();
    return { sessionId: id, appId: input.app_id, sub: input.sub, email: input.email, issuer: input.issuer, deviceLabel: deviceLabelFromUa(input.user_agent), botSnapshot: input.bot_snapshot ?? [], uaHash: hashUa(input.user_agent) };
  },

  /**
   * Validate a cookie value for a given app. Enforces BOTH clocks and app binding.
   * Does NOT touch — callers decide (touch on successful runtime use only).
   */
  findValid(db: DrizzleDb, sessionId: string, appId: string): SessionPrincipal | null {
    if (!sessionId) return null;
    const row = db.select().from(app_sessions).where(eq(app_sessions.id, sessionId)).get();
    if (!row) return null;
    const t = now();
    if (row.revoked_at) return null;
    if (row.app_id !== appId) return null;                    // cross-app reuse — hard fail
    if (row.idle_expires_at <= t) return null;                // idle timeout
    if (row.absolute_expires_at <= t) return null;            // absolute cap
    return toPrincipal(row);
  },

  /** Raw lookup without app binding — used by logout (session owns its app). */
  findById(db: DrizzleDb, sessionId: string): AppSession | null {
    return db.select().from(app_sessions).where(eq(app_sessions.id, sessionId)).get() ?? null;
  },

  /** Sliding idle window + IP metadata update. Never blocks — IP is not a gate. */
  touch(db: DrizzleDb, sessionId: string, cfg: Required<SessionConfig>, ip: string | null): void {
    const t = now();
    const patch: Record<string, unknown> = {
      last_active_at: t,
      idle_expires_at: minsFromNow(cfg.ttl_idle_min),
    };
    if (ip) patch["last_seen_ip"] = ip;
    db.update(app_sessions).set(patch).where(eq(app_sessions.id, sessionId)).run();
  },

  revoke(db: DrizzleDb, sessionId: string): void {
    db.update(app_sessions).set({ revoked_at: now() }).where(eq(app_sessions.id, sessionId)).run();
  },

  /** Keep `keepSessionId`, revoke every other active session for this user on this app. */
  revokeOthers(db: DrizzleDb, appId: string, sub: string, keepSessionId: string): number {
    const active = db.select().from(app_sessions)
      .where(and(
        eq(app_sessions.app_id, appId),
        eq(app_sessions.sub, sub),
        isNull(app_sessions.revoked_at),
      ))
      .all();
    let n = 0;
    for (const s of active) {
      if (s.id === keepSessionId) continue;
      db.update(app_sessions).set({ revoked_at: now() }).where(eq(app_sessions.id, s.id)).run();
      n++;
    }
    return n;
  },

  revokeAllForAppUser(db: DrizzleDb, appId: string, sub: string): void {
    db.update(app_sessions).set({ revoked_at: now() })
      .where(and(eq(app_sessions.app_id, appId), eq(app_sessions.sub, sub), isNull(app_sessions.revoked_at)))
      .run();
  },

  listActiveForAppUser(db: DrizzleDb, appId: string, sub: string) {
    const t = now();
    return db.select().from(app_sessions)
      .where(and(
        eq(app_sessions.app_id, appId),
        eq(app_sessions.sub, sub),
        isNull(app_sessions.revoked_at),
        gt(app_sessions.absolute_expires_at, t),
        gt(app_sessions.idle_expires_at, t),
      ))
      .all()
      .map(serializeSummary);
  },

  /** Admin view — all active sessions for an app. */
  listActiveForApp(db: DrizzleDb, appId: string) {
    const t = now();
    return db.select().from(app_sessions)
      .where(and(
        eq(app_sessions.app_id, appId),
        isNull(app_sessions.revoked_at),
        gt(app_sessions.absolute_expires_at, t),
        gt(app_sessions.idle_expires_at, t),
      ))
      .all()
      .map(serializeSummary);
  },

  /** Purge rows past either clock (revoked rows older than 7 days too). */
  purgeExpired(db: DrizzleDb): number {
    const t = now();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const r1 = db.delete(app_sessions)
      .where(or(lt(app_sessions.idle_expires_at, t), lt(app_sessions.absolute_expires_at, t)))
      .run();
    const r2 = db.delete(app_sessions)
      .where(and(sql`${app_sessions.revoked_at} IS NOT NULL`, lt(app_sessions.revoked_at, weekAgo)))
      .run();
    return r1.changes + r2.changes;
  },
};

function serializeSummary(row: AppSession) {
  return {
    id: row.id,
    app_id: row.app_id,
    sub: row.sub,
    email: row.email,
    issuer: row.issuer,
    device_label: row.device_label,
    last_seen_ip: row.last_seen_ip,
    last_active_at: row.last_active_at,
    idle_expires_at: row.idle_expires_at,
    absolute_expires_at: row.absolute_expires_at,
    created_at: row.created_at,
  };
}
