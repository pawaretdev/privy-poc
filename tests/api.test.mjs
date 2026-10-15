import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.mjs';
import { createApi } from '../server/app.mjs';

const address = `0x${'1'.repeat(40)}`;
const claims = uid => ({ uid, email: `${uid}@example.test`, name: 'Test user', firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [uid] } } });
const privyUser = uid => ({ id: `did:privy:${uid}`, linked_accounts: [{ type: 'custom_auth', custom_user_id: uid }, { type: 'wallet', wallet_client_type: 'privy', chain_type: 'ethereum', id: `wallet-${uid}`, address, imported: false, delegated: false }] });

async function fixture(t, lookup = async uid => privyUser(uid)) {
  const store = openStore(':memory:');
  const app = createApi({ store, jwtIssuer: { jwks: { keys: [] }, issue: uid => `signed:${uid}` }, appId: 'test-app', origins: ['https://fe.pawaret.uk'], verifyToken: async token => { if (token === 'invalid') throw new Error('invalid'); return claims(token); }, getPrivyUser: lookup });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); store.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, options = {}) => fetch(base + path, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  return { store, request };
}

test('rejects missing/invalid authentication and disallowed origins without creating users', async t => {
  const { store, request } = await fixture(t);
  assert.equal((await request('/api/me')).status, 401);
  assert.equal((await request('/api/me', 'invalid')).status, 401);
  assert.equal((await request('/api/auth/privy-jwt', 'invalid', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/me', 'alice', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
});

test('bridge JWT subject comes only from the verified Firebase identity', async t => {
  const { request } = await fixture(t);
  const response = await request('/api/auth/privy-jwt', 'alice', { method: 'POST', body: JSON.stringify({ uid: 'victim' }) });
  assert.equal((await response.json()).token, 'signed:alice');
});

test('repeated and simultaneous syncs reuse the same account and wallet', async t => {
  const { store, request } = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 5 }, () => request('/api/wallet/sync', 'alice', { method: 'POST' })));
  assert.ok(responses.every(r => r.status === 200));
  const accounts = await Promise.all(responses.map(r => r.json()));
  assert.ok(accounts.every(a => a.user.id === accounts[0].user.id));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM privy_wallet').get().n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
});

test('mismatched custom-auth identity cannot be mapped', async t => {
  const { store, request } = await fixture(t, async () => privyUser('mallory'));
  assert.equal((await request('/api/wallet/sync', 'alice', { method: 'POST' })).status, 403);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM privy_wallet').get().n, 0);
});

test('ignores forged body fields and preserves existing legacy wallets', async t => {
  const { store, request } = await fixture(t);
  const alice = store.user(claims('alice'));
  store.db.prepare('INSERT INTO wallet (user_id,wallet_address) VALUES (?,?)').run(alice.id, 'metamask-existing');
  store.db.prepare('INSERT INTO ronin_wallet (user_id,wallet_address) VALUES (?,?)').run(alice.id, 'ronin-existing');
  const response = await request('/api/wallet/sync', 'alice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: 'victim', wallet_address: 'forged' }) });
  const result = await response.json();
  assert.equal(result.user.user_id, 'alice');
  assert.equal(result.privy_wallet.wallet_address, address);
  assert.equal(result.wallet.wallet_address, 'metamask-existing');
  assert.equal(result.ronin_wallet.wallet_address, 'ronin-existing');
  const bob = await (await request('/api/me', 'bob')).json();
  assert.equal(bob.privy_wallet, null);
});

test('refuses silent remapping and cross-user address collisions', async t => {
  let replacement = false;
  const { request } = await fixture(t, async uid => {
    const result = privyUser(uid);
    if (replacement && uid === 'alice') result.linked_accounts[1].id = 'replacement';
    return result;
  });
  assert.equal((await request('/api/wallet/sync', 'alice', { method: 'POST' })).status, 200);
  replacement = true;
  assert.equal((await request('/api/wallet/sync', 'alice', { method: 'POST' })).status, 409);
  assert.equal((await request('/api/wallet/sync', 'bob', { method: 'POST' })).status, 409);
});

test('rejects delegated/imported/multiple wallets and allows recovery after provider failure', async t => {
  let mode = 'delegated';
  const { request } = await fixture(t, async uid => {
    const result = privyUser(uid);
    if (mode === 'delegated') result.linked_accounts[1].delegated = true;
    if (mode === 'imported') result.linked_accounts[1].imported = true;
    if (mode === 'multiple') result.linked_accounts.push({ ...result.linked_accounts[1], id: 'other' });
    if (mode === 'failure') throw new Error('upstream failure');
    return result;
  });
  for (const next of ['delegated', 'imported', 'multiple', 'failure', 'success']) {
    mode = next;
    const response = await request('/api/wallet/sync', 'alice', { method: 'POST' });
    assert.equal(response.status, next === 'success' ? 200 : next === 'failure' ? 500 : 409);
  }
});
