import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "../client.js";
import { mail_senders, mail_routes, type MailSender, type MailRoute } from "../schema.js";
import { resolveSecret } from "../../secrets/resolver.js";

/**
 * Multiple named SMTP senders with purpose-based routing.
 *
 * Purposes (v1: "verification", extensible) map to a sender via mail_routes.
 * A route row with app_id NULL is the org-level default; app-specific rows
 * override it. Passwords live in the Secrets vault and are decrypted only at
 * send time. BYO credentials — Gmail app password, SES SMTP, Postmark, etc.
 */

export const MAIL_PURPOSES = ["verification", "otp"] as const;
export type MailPurpose = (typeof MAIL_PURPOSES)[number];

export type SerializedMailSender = Omit<MailSender, "is_active"> & {
  is_active: boolean;
  password_set: boolean;      // never expose the ref value itself
};

export type ResolvedSender = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string } | null;
  from: string;               // '"Name" <addr>' or bare address
};

function serializeSender(row: MailSender): SerializedMailSender {
  const { is_active, ...rest } = row;
  return {
    ...rest,
    is_active: Boolean(is_active),
    password_set: Boolean(row.password_ref),
  };
}

function serializeRoute(row: MailRoute) {
  return { id: row.id, purpose: row.purpose, app_id: row.app_id, sender_id: row.sender_id };
}

export const mailSenderRepo = {
  // ── Senders ──────────────────────────────────────────────────────────────────

  listSenders(): SerializedMailSender[] {
    return getDb().select().from(mail_senders).all().map(serializeSender);
  },

  findSender(id: string): SerializedMailSender | null {
    const row = getDb().select().from(mail_senders).where(eq(mail_senders.id, id)).get();
    return row ? serializeSender(row) : null;
  },

  createSender(db: import("./types.js").DrizzleDb, input: SenderInput): SerializedMailSender {
    const t = new Date().toISOString();
    const id = randomUUID();
    db.insert(mail_senders).values({
      id,
      name: input.name.trim(),
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      username: input.username.trim(),
      password_ref: input.password_ref ?? null,
      from_address: input.from_address.trim(),
      from_name: input.from_name?.trim() ?? "",
      is_active: input.is_active ?? true,
      updated_by: input.updated_by ?? null,
      created_at: t,
      updated_at: t,
    }).run();
    return serializeSender(db.select().from(mail_senders).where(eq(mail_senders.id, id)).get()!);
  },

  updateSender(db: import("./types.js").DrizzleDb, id: string, input: Partial<SenderInput>): SerializedMailSender | null {
    const existing = db.select().from(mail_senders).where(eq(mail_senders.id, id)).get();
    if (!existing) return null;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name         !== undefined) patch["name"]         = input.name.trim();
    if (input.host         !== undefined) patch["host"]         = input.host.trim();
    if (input.port         !== undefined) patch["port"]         = input.port;
    if (input.secure       !== undefined) patch["secure"]       = input.secure;
    if (input.username     !== undefined) patch["username"]     = input.username.trim();
    if (input.from_address !== undefined) patch["from_address"] = input.from_address.trim();
    if (input.from_name    !== undefined) patch["from_name"]    = input.from_name.trim();
    if (input.is_active    !== undefined) patch["is_active"]    = input.is_active;
    if (input.updated_by   !== undefined) patch["updated_by"]   = input.updated_by;
    // undefined = keep existing secret; null = clear
    if (input.password_ref !== undefined) patch["password_ref"] = input.password_ref;
    db.update(mail_senders).set(patch).where(eq(mail_senders.id, id)).run();
    return serializeSender(db.select().from(mail_senders).where(eq(mail_senders.id, id)).get()!);
  },

  deleteSender(db: import("./types.js").DrizzleDb, id: string): { success: boolean; detail?: string } {
    const routes = db.select().from(mail_routes).where(eq(mail_routes.sender_id, id)).all();
    if (routes.length > 0) {
      return { success: false, detail: `Sender is routed for: ${[...new Set(routes.map(r => r.purpose))].join(", ")} — reassign the route first` };
    }
    db.delete(mail_senders).where(eq(mail_senders.id, id)).run();
    return { success: true };
  },

  // ── Routes (purpose → sender) ────────────────────────────────────────────────

  listRoutes(appId?: string): ReturnType<typeof serializeRoute>[] {
    const rows = appId
      ? getDb().select().from(mail_routes).where(eq(mail_routes.app_id, appId)).all()
      : getDb().select().from(mail_routes).where(isNull(mail_routes.app_id)).all();
    return rows.map(serializeRoute);
  },

  setRoute(db: import("./types.js").DrizzleDb, purpose: string, senderId: string, appId?: string | null): ReturnType<typeof serializeRoute> {
    const t = new Date().toISOString();
    const existing = appId
      ? db.select().from(mail_routes).where(and(eq(mail_routes.purpose, purpose), eq(mail_routes.app_id, appId))).get()
      : db.select().from(mail_routes).where(and(eq(mail_routes.purpose, purpose), isNull(mail_routes.app_id))).get();
    if (existing) {
      db.update(mail_routes).set({ sender_id: senderId, updated_at: t }).where(eq(mail_routes.id, existing.id)).run();
      return serializeRoute(db.select().from(mail_routes).where(eq(mail_routes.id, existing.id)).get()!);
    }
    const id = randomUUID();
    db.insert(mail_routes).values({
      id, purpose, app_id: appId ?? null, sender_id: senderId, created_at: t, updated_at: t,
    }).run();
    return serializeRoute(db.select().from(mail_routes).where(eq(mail_routes.id, id)).get()!);
  },

  clearRoute(db: import("./types.js").DrizzleDb, purpose: string, appId?: string | null): void {
    if (appId) {
      db.delete(mail_routes).where(and(eq(mail_routes.purpose, purpose), eq(mail_routes.app_id, appId))).run();
    } else {
      db.delete(mail_routes).where(and(eq(mail_routes.purpose, purpose), isNull(mail_routes.app_id))).run();
    }
  },

  // ── Resolution (send path) ───────────────────────────────────────────────────

  /**
   * Resolve the sender for a purpose: app-specific route first, then the
   * org-level default route. Returns null when unrouted / inactive.
   */
  resolveForSend(purpose: MailPurpose, appId?: string | null): ResolvedSender | null {
    const db = getDb();
    let row = appId
      ? db.select().from(mail_routes).where(and(eq(mail_routes.purpose, purpose), eq(mail_routes.app_id, appId))).get()
      : undefined;
    if (!row) {
      row = db.select().from(mail_routes).where(and(eq(mail_routes.purpose, purpose), isNull(mail_routes.app_id))).get();
    }
    if (!row) return null;
    const sender = db.select().from(mail_senders).where(eq(mail_senders.id, row.sender_id)).get();
    if (!sender || !sender.is_active) return null;

    let auth: ResolvedSender["auth"] = null;
    if (sender.password_ref) {
      auth = { user: sender.username, pass: resolveSecret(sender.password_ref) };
    }
    const from = sender.from_name
      ? `"${sender.from_name.replace(/"/g, "'")}" <${sender.from_address}>`
      : sender.from_address;
    return {
      id: sender.id, name: sender.name,
      host: sender.host, port: sender.port, secure: Boolean(sender.secure),
      auth, from,
    };
  },

  /** Resolve one sender by id (admin test-send). Returns null when missing/inactive. */
  resolveSenderById(id: string): ResolvedSender | null {
    const sender = getDb().select().from(mail_senders).where(eq(mail_senders.id, id)).get();
    if (!sender) return null;
    let auth: ResolvedSender["auth"] = null;
    if (sender.password_ref) {
      auth = { user: sender.username, pass: resolveSecret(sender.password_ref) };
    }
    const from = sender.from_name
      ? `"${sender.from_name.replace(/"/g, "'")}" <${sender.from_address}>`
      : sender.from_address;
    return {
      id: sender.id, name: sender.name,
      host: sender.host, port: sender.port, secure: Boolean(sender.secure),
      auth, from,
    };
  },

  /** Any active sender — used by the admin test-send when no route exists yet. */
  firstActiveSender(): ResolvedSender | null {
    const rows = getDb().select().from(mail_senders).where(eq(mail_senders.is_active, true)).all();
    for (const sender of rows) {
      const resolved = mailSenderRepo.resolveSenderById(sender.id);
      if (resolved) return resolved;
    }
    return null;
  },
};

export type SenderInput = {
  name: string; host: string; port: number; secure: boolean; username: string;
  password_ref?: string | null; from_address: string; from_name?: string;
  is_active?: boolean; updated_by?: string | null;
};
