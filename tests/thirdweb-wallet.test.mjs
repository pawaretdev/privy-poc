import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.mjs';
import { createApi } from '../server/app.mjs';

const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const claims = uid => ({ uid, email: `${uid}@example.test`, name: 'Test user', firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [uid] } } });
// Shape of thirdweb's user-details response for a custom-JWT login.
const twUser = (uid, address, userId = `tw-${uid}`) => ({ userId, walletAddress: address, smartAccountAddress: null, linkedAccounts: [{ type: 'jwt', details: { id: uid } }] });

async function fixture(t, users = {}, thirdweb = {}) {
  const store = openStore(':memory:');
  const app = createApi({ store, jwtIssuer: { jwks: { keys: [] } }, appId: 'test-app', origins: ['https://fe.pawaret.uk'], verifyToken: async token => claims(token),
    thirdweb: { audience: 'tw-client', configurationError: null, syncError: null, clientId: 'tw-client', lookupUser: async (_config, address) => users[address.toLowerCase()] ?? null, ...thirdweb } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.close(); store.db.close(); });
  const sync = (uid, address, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/thirdweb/wallet/sync`, { method: 'POST', headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ address }) });
  return { store, sync, rows: () => store.db.prepare('SELECT COUNT(*) AS n FROM thirdweb_wallet').get().n };
}

test('saves the thirdweb wallet once thirdweb confirms it belongs to the Firebase UID', async t => {
  const { sync, rows } = await fixture(t, { [A]: twUser('alice', A) });
  const first = await sync('alice', A);
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.user.user_id, 'alice');
  assert.deepEqual([body.thirdweb_wallet.wallet_address, body.thirdweb_wallet.thirdweb_user_id, body.thirdweb_wallet.thirdweb_client_id], [A, 'tw-alice', 'tw-client']);
  assert.equal((await sync('alice', A.toUpperCase().replace('0X', '0x'))).status, 200);
  assert.equal(rows(), 1);
});

test('rejects an address that thirdweb ties to someone else', async t => {
  const { sync, rows } = await fixture(t, { [A]: twUser('alice', A) });
  assert.equal((await sync('mallory', A)).status, 403);
  assert.equal(rows(), 0);
});

test('rejects unknown wallets, bad input, and untrusted origins', async t => {
  const { sync, rows } = await fixture(t, { [A]: twUser('alice', A) });
  assert.equal((await sync('alice', B)).status, 409);
  assert.equal((await sync('alice', 'not-an-address')).status, 400);
  assert.equal((await sync('alice', A, { Origin: 'https://untrusted.test' })).status, 403);
  assert.equal(rows(), 0);
});

test('never silently remaps a user to a different thirdweb wallet', async t => {
  const users = { [A]: twUser('alice', A) };
  const { sync, rows } = await fixture(t, users);
  assert.equal((await sync('alice', A)).status, 200);
  users[B] = twUser('alice', B, 'tw-alice-2');
  assert.equal((await sync('alice', B)).status, 409);
  assert.equal(rows(), 1);
});

test('reports missing secret key without calling thirdweb', async t => {
  let called = false;
  const { sync } = await fixture(t, {}, { syncError: 'Missing server configuration: THIRDWEB_SECRET_KEY', lookupUser: async () => { called = true; } });
  const response = await sync('alice', A);
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /THIRDWEB_SECRET_KEY/);
  assert.equal(called, false);
});
