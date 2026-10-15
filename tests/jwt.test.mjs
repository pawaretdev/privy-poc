import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { createJwtIssuer } from '../server/jwt.mjs';

test('bridge signs short-lived JWTs, persists key, exposes only public material', t => {
  const dir = mkdtempSync(join(tmpdir(), 'stash-jwt-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'key.pem');
  const issuer = createJwtIssuer(path, 'https://test.example', 'app-id');
  const token = issuer.issue('firebase-uid');
  const [header, body, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(payload.sub, 'firebase-uid');
  assert.equal(payload.iss, 'https://test.example');
  assert.equal(payload.aud, 'app-id');
  assert.equal(payload.exp - payload.iat, 300);
  assert.equal(issuer.jwks.keys[0].d, undefined);
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${body}`), createPublicKey({ key: issuer.jwks.keys[0], format: 'jwk' }), Buffer.from(signature, 'base64url')));
  assert.deepEqual(createJwtIssuer(path, 'https://test.example', 'app-id').jwks, issuer.jwks);
});
