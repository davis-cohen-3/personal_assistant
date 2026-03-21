import crypto from "node:crypto";
import { AppError } from "./exceptions.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new AppError("Missing ENCRYPTION_KEY", 500);
  return Buffer.from(keyHex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Append auth tag to ciphertext so format stays <hex_iv>:<hex_ciphertext>
  const combined = Buffer.concat([encrypted, authTag]);
  return `${iv.toString("hex")}:${combined.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 2) throw new AppError("Invalid ciphertext format", 500);

  const [ivHex, combinedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const combined = Buffer.from(combinedHex, "hex");

  // Last AUTH_TAG_LENGTH bytes are the auth tag
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
