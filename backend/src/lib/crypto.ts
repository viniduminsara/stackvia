import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

type EncryptedPayload = {
  encryptedUri: string;
  iv: string;
  authTag: string;
};

function deriveKey() {
  const secret = process.env.ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is required for MongoDB credential storage');
  }

  return secret.length >= 32 && /^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0
    ? Buffer.from(secret, 'hex')
    : scryptSync(secret, 'stackvia-mongodb-credentials', 32);
}

export function encryptSecret(value: string): EncryptedPayload {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedUri: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = deriveKey();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encryptedUri, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
