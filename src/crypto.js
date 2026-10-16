import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM for secrets at rest (sub-account API secrets). Format: iv.tag.ciphertext (hex)
function key() {
  return Buffer.from(config.encryptionKey, 'hex');
}

export function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('hex')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((h) => Buffer.from(h, 'hex'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
