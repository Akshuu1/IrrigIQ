import crypto from 'node:crypto';
import { getEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const env = getEnv();
  const rawKey = env.CHAT_ENCRYPTION_KEY;
  // If 64 hex characters (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  // Otherwise derive 32-byte key via SHA-256
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts personal identifiers (chat ID, phone numbers, tokens) at rest using AES-256-GCM.
 * Output format: `${ivHex}:${authTagHex}:${ciphertextHex}`
 */
export function encryptExternalId(plainText: string): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty external identifier');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted external identifiers.
 */
export function decryptExternalId(encryptedPayload: string): string {
  if (!encryptedPayload || !encryptedPayload.includes(':')) {
    throw new Error('Invalid encrypted payload format');
  }
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed AES-256-GCM payload');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Deterministic SHA-256 hash used for database queries without exposing plain IDs in logs or indexes.
 */
export function hashExternalId(externalId: string): string {
  return crypto.createHash('sha256').update(externalId.trim()).digest('hex');
}

/**
 * Generates a cryptographically secure 6-character linking code (e.g. 849201).
 */
export function generateLinkCode(): string {
  // 6 digits or uppercase alphanumeric
  const num = crypto.randomInt(100000, 999999);
  return num.toString();
}

/**
 * Hashes a link code using SHA-256 for secure database storage.
 */
export function hashLinkCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

