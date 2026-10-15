import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function createJwtIssuer(keyPath, issuer, audience) {
  try {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify(publicKey)).digest('hex').slice(0, 24);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    jwks: { keys: [{ ...publicKey, kid, use: 'sig', alg: 'RS256' }] },
    issue(uid) {
      const now = Math.floor(Date.now() / 1000);
      const data = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode({ sub: uid, iss: issuer, aud: audience, iat: now, exp: now + 300 })}`;
      return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
    },
  };
}
