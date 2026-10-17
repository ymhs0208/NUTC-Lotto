import { scrypt, timingSafeEqual } from 'node:crypto';

// Keep the existing encoding and work factor: no password reset or migration.
export const PASSWORD_HASH_FORMAT = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const SCRYPT_COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;
export function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT_COST, (error, result) => error ? reject(error) : resolve(result));
  });
}
export async function checkPasswordKey(password: string, encoded: string | null): Promise<boolean> {
  const match = encoded?.match(PASSWORD_HASH_FORMAT);
  // Unknown accounts still incur the same work factor.
  const actual = await derivePasswordKey(password, match?.[1] || '0'.repeat(32));
  return !!match && timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
