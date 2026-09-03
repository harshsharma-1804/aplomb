import { createDecipheriv, createCipheriv, randomBytes } from "crypto";
import { Secret } from "../models/Secret.js";
import type { Types } from "mongoose";
import { config } from "../config/appConfig.js";

function getKey(): Buffer {
  const keyEnv = config.secrets.encryptionKey;
  if (keyEnv.length !== config.secrets.keyLengthRequired) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must be exactly ${config.secrets.keyLengthRequired} ASCII characters`);
  }
  return Buffer.from(keyEnv, "utf8");
}

export async function resolveSecret(secretRef: Types.ObjectId | string): Promise<string> {
  const secret = await Secret.findById(secretRef).lean();
  if (!secret) throw new Error(`Secret not found: ${String(secretRef)}`);

  const key = getKey();
  const iv = Buffer.from(secret.iv, "base64");
  const authTag = Buffer.from(secret.auth_tag, "base64");
  const ciphertext = Buffer.from(secret.ciphertext, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  Secret.findByIdAndUpdate(secretRef, { last_used_at: new Date() }).catch(() => {});

  return plaintext.toString("utf8");
}

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; auth_tag: string } {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: authTag.toString("base64"),
  };
}
