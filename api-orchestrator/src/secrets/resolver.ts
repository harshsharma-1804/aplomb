import { createDecipheriv, createCipheriv, randomBytes } from "crypto";
import { getDb } from "../db/client.js";
import { secretRepo } from "../db/repos/secretRepo.js";
import { config } from "../config/appConfig.js";

function getKey(): Buffer {
  const keyEnv = config.secrets.encryptionKey;
  if (keyEnv.length !== config.secrets.keyLengthRequired) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must be exactly ${config.secrets.keyLengthRequired} ASCII characters`);
  }
  return Buffer.from(keyEnv, "utf8");
}

export function resolveSecret(secretRef: string): string {
  const db = getDb();
  const secret = secretRepo.findById(db, secretRef);
  if (!secret) throw new Error(`Secret not found: ${secretRef}`);
  return decryptRaw(secret.ciphertext, secret.iv, secret.auth_tag);
}

/** AES-256-GCM decrypt of raw stored parts (used for TOTP secrets on user rows). */
export function decryptRaw(ciphertext: string, iv: string, authTag: string): string {
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
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
