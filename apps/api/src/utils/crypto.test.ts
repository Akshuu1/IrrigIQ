import { describe, it, expect } from 'vitest';
import {
  encryptExternalId,
  decryptExternalId,
  hashExternalId,
  generateLinkCode,
  hashLinkCode,
} from './crypto.js';

describe('AES-256-GCM Crypto and Personal Data Utilities', () => {
  it('encrypts and decrypts an external identifier correctly', () => {
    const rawChatId = '123456789';
    const encrypted = encryptExternalId(rawChatId);

    // Ensure format is iv:authTag:ciphertext
    expect(encrypted).not.toBe(rawChatId);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptExternalId(encrypted);
    expect(decrypted).toBe(rawChatId);
  });

  it('produces different ciphertexts for identical inputs due to random IV', () => {
    const rawChatId = '987654321';
    const enc1 = encryptExternalId(rawChatId);
    const enc2 = encryptExternalId(rawChatId);

    expect(enc1).not.toBe(enc2);
    expect(decryptExternalId(enc1)).toBe(rawChatId);
    expect(decryptExternalId(enc2)).toBe(rawChatId);
  });

  it('fails to decrypt tampered ciphertexts or corrupted auth tag', () => {
    const encrypted = encryptExternalId('secure_id_123');
    const parts = encrypted.split(':');
    // Tamper ciphertext
    const tampered = `${parts[0]}:${parts[1]}:deadbeef`;

    expect(() => decryptExternalId(tampered)).toThrow();
  });

  it('creates deterministic HMAC-SHA256 blind index with CHAT_INDEX_KEY', () => {
    const rawChatId = '  5544332211  ';
    const hash1 = hashExternalId(rawChatId);
    const hash2 = hashExternalId('5544332211');

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).not.toContain('5544332211');

    // Different secret key produces a completely different blind index
    const otherKey = 'a'.repeat(64);
    const hashOther = hashExternalId('5544332211', otherKey);
    expect(hashOther).not.toBe(hash1);
    expect(hashOther).toMatch(/^[0-9a-f]{64}$/);

    // Empty identifier throws
    expect(() => hashExternalId('')).toThrow('Cannot hash empty external identifier');
  });

  it('generates 6-digit numeric link codes', () => {
    const code = generateLinkCode();
    expect(code).toMatch(/^\d{6}$/);
    const num = parseInt(code, 10);
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThanOrEqual(999999);
  });

  it('hashes link code consistently with case/space normalization', () => {
    const code = '123456';
    const hash1 = hashLinkCode(code);
    const hash2 = hashLinkCode(' 123456 ');

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});

