// Encrypted settings store. The Anthropic API key can be entered through the
// web UI instead of .env; it is encrypted with a key derived from
// CRUCIBLE_ACCESS_KEY (scrypt → AES-256-GCM), so the file on disk is useless
// without the access key — which lives only in the server's environment, not
// on the data volume. Consequence to know: changing the access key makes the
// stored API key unreadable and it must be re-entered.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Lives alongside the ledger so one volume holds all state. The leading
// underscore keeps it out of the ledger's thread listing.
const settingsFile = () => path.join(config.ledgerDir, '_settings.json');

export function encryptSecret(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptSecret(box, passphrase) {
  const key = crypto.scryptSync(passphrase, Buffer.from(box.salt, 'base64'), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(config.ledgerDir, { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}

export function storeApiKey(apiKey, passphrase) {
  const settings = readSettings();
  settings.anthropicApiKey = encryptSecret(apiKey, passphrase);
  writeSettings(settings);
}

export function clearApiKey() {
  const settings = readSettings();
  delete settings.anthropicApiKey;
  writeSettings(settings);
}

/**
 * @returns {{key: string|null, status: 'stored'|'unset'|'unreadable'}}
 * 'unreadable' means a key is stored but the passphrase (access key) no
 * longer decrypts it — i.e. CRUCIBLE_ACCESS_KEY changed since it was saved.
 */
export function loadApiKey(passphrase) {
  const settings = readSettings();
  if (!settings.anthropicApiKey) return { key: null, status: 'unset' };
  try {
    return { key: decryptSecret(settings.anthropicApiKey, passphrase), status: 'stored' };
  } catch {
    return { key: null, status: 'unreadable' };
  }
}
