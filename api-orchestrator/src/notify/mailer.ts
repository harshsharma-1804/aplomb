import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { mailSenderRepo, type MailPurpose, type ResolvedSender } from "../db/repos/mailSenderRepo.js";

/**
 * Transactional email via named SMTP senders with purpose-based routing
 * (see mailSenderRepo). Transport instances are cached per sender config so
 * different purposes can use different providers. Passwords are decrypted
 * from the Secrets vault only at send time.
 */

const transportCache = new Map<string, { key: string; transport: Transporter }>();

function transportKey(cfg: ResolvedSender): string {
  return `${cfg.host}:${cfg.port}:${cfg.secure ? 1 : 0}:${cfg.auth?.user ?? ""}:${cfg.auth?.pass.length ?? 0}`;
}

function getTransport(cfg: ResolvedSender): Transporter {
  const key = transportKey(cfg);
  const cached = transportCache.get(cfg.id);
  if (cached && cached.key === key) return cached.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth ?? undefined,
  });
  transportCache.set(cfg.id, { key, transport });
  return transport;
}

export function isMailConfigured(purpose: MailPurpose = "verification"): boolean {
  return mailSenderRepo.resolveForSend(purpose) !== null;
}

export class MailNotConfiguredError extends Error {
  constructor(purpose?: MailPurpose) {
    super(purpose ? `No mail sender is routed for purpose "${purpose}"` : "Mail is not configured for this organization");
  }
}

export async function sendMail(params: {
  purpose: MailPurpose;
  appId?: string | null;          // per-app route override
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sender: string }> {
  const cfg = mailSenderRepo.resolveForSend(params.purpose, params.appId);
  if (!cfg) throw new MailNotConfiguredError(params.purpose);
  return deliver(cfg, params);
}

/** Send via a specific sender by id (admin test-send, bypasses routing). */
export async function sendViaSender(senderId: string, params: {
  to: string; subject: string; html: string; text: string;
}): Promise<{ sender: string }> {
  const cfg = mailSenderRepo.resolveSenderById(senderId);
  if (!cfg) throw new MailNotConfiguredError();
  return deliver(cfg, params);
}

async function deliver(cfg: ResolvedSender, params: { to: string; subject: string; html: string; text: string }): Promise<{ sender: string }> {
  const transport = getTransport(cfg);
  await transport.sendMail({
    from: cfg.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return { sender: cfg.name };
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function verificationEmailHtml(appName: string, verifyUrl: string, ttlHours: number): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a202c;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="font-size:18px;">Verify your email — ${appName}</h2>
  <p>Welcome! Confirm this email address to activate your account.</p>
  <p style="margin:24px 0;">
    <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Verify email</a>
  </p>
  <p style="color:#4a5568;font-size:13px;">Or paste this link into your browser:<br><code style="font-size:12px;word-break:break-all;">${verifyUrl}</code></p>
  <p style="color:#a0aec0;font-size:12px;">This link expires in ${ttlHours} hours. If you didn't sign up, you can ignore this email.</p>
</body></html>`;
}

export function verificationEmailText(appName: string, verifyUrl: string, ttlHours: number): string {
  return `Verify your email — ${appName}\n\nConfirm this email address to activate your account:\n${verifyUrl}\n\nThis link expires in ${ttlHours} hours. If you didn't sign up, you can ignore this email.`;
}

// ── 2FA OTP templates ─────────────────────────────────────────────────────────

export function otpEmailHtml(appName: string, code: string, ttlMin: number): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a202c;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="font-size:18px;">Your sign-in code — ${appName}</h2>
  <p>Use this code to finish signing in:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:20px 0;">${code}</p>
  <p style="color:#4a5568;font-size:13px;">This code expires in ${ttlMin} minutes and can be used once.</p>
  <p style="color:#a0aec0;font-size:12px;">If you didn't try to sign in, someone knows your password — change it and contact support.</p>
</body></html>`;
}

export function otpEmailText(appName: string, code: string, ttlMin: number): string {
  return `Your sign-in code — ${appName}\n\nCode: ${code}\n\nExpires in ${ttlMin} minutes, single use. If you didn't try to sign in, change your password immediately.`;
}
