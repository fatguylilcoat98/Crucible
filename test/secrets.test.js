import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/secrets.js';

test('secret round-trips through encrypt/decrypt', () => {
  const box = encryptSecret('sk-ant-api03-super-secret', 'my-access-key');
  assert.ok(!JSON.stringify(box).includes('super-secret'), 'ciphertext does not leak the plaintext');
  assert.equal(decryptSecret(box, 'my-access-key'), 'sk-ant-api03-super-secret');
});

test('wrong passphrase cannot decrypt', () => {
  const box = encryptSecret('sk-ant-api03-super-secret', 'right-key');
  assert.throws(() => decryptSecret(box, 'wrong-key'));
});

test('same secret encrypts to different ciphertext each time (fresh salt/iv)', () => {
  const a = encryptSecret('sk-ant-x', 'k');
  const b = encryptSecret('sk-ant-x', 'k');
  assert.notEqual(a.data, b.data);
  assert.notEqual(a.salt, b.salt);
});
