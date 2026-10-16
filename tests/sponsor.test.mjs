import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeErc1155Buy, marketAssets, parseSponsorItems, verifySponsorship, MARKET_GATEWAY } from '../server/mavisMarket.mjs';
import { createApi } from '../server/app.mjs';

const RESOURCES = '0xac78515ef7d0bb935bc86d4f8ce314038946b52f';
const GAME_ITEMS = '0xc5da607b372eca2794f5b5452148751c358eb53c';
const buyer = '0xA52Ab43827bC0b216168450c5dc4FDe1235cce2C';
const config = { chainId: 2020, items: parseSponsorItems(`${RESOURCES}:32`) };
// Live Mavis Market listing (Resources #32), captured 2026-10-16.
const order = (collection, id = '32') => ({
  maker: '0xb55d068a4ad36c49312502f5083f6de297fe55fc', kind: 'Sell', assets: [{ erc: 'Erc1155', address: collection, id, quantity: '2' }],
  expiredAt: 1794745675, paymentToken: '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4', startedAt: 1792067275, basePrice: '899999999000000',
  expectedState: '0', nonce: 0, currentPrice: '899999999000000',
  signature: '0xbd030671a14f99dbbf6213c98d4ff6e9406f8c68936e2a3ab9118913b8bf63f96f1ec01adeef7324e5dd652f56c3d1b07ee25dc707b96bb82f8b7eee3ed874fc1b',
});
const userOp = (calls, sender = buyer) => ({ chainId: 2020, userOp: { sender, targets: calls.map(c => c.to), data: { targets: calls.map(c => c.to), callDatas: calls.map(c => c.data), values: calls.map(c => String(c.value)) } } });

test('decodes the item a market buy trades', () => {
  const tx = encodeErc1155Buy(order(RESOURCES), buyer);
  assert.equal(tx.to, MARKET_GATEWAY);
  assert.equal(tx.value, 899999999000000n);
  assert.deepEqual(marketAssets(tx.data).map(a => [a.collection.toLowerCase(), a.tokenId]), [[RESOURCES, '32']]);
});

test('parses the sponsor allowlist and rejects malformed entries', () => {
  assert.deepEqual(parseSponsorItems(`${RESOURCES}:32, ${GAME_ITEMS}:*`).map(i => i.tokenId), ['32', '*']);
  assert.throws(() => parseSponsorItems(RESOURCES));
  assert.throws(() => parseSponsorItems('0x123:1'));
});

test('sponsors allowlisted items and the self-test only', () => {
  assert.deepEqual(verifySponsorship(userOp([encodeErc1155Buy(order(RESOURCES), buyer)]), config), { isAllowed: true });
  assert.deepEqual(verifySponsorship(userOp([{ to: buyer, data: '0x', value: 0 }]), config), { isAllowed: true });
});

test('denies other tokens and collections, even batched with an allowed buy', () => {
  const blocked = encodeErc1155Buy(order(GAME_ITEMS), buyer);
  assert.equal(verifySponsorship(userOp([blocked]), config).isAllowed, false);
  assert.equal(verifySponsorship(userOp([encodeErc1155Buy(order(RESOURCES, '33'), buyer)]), config).isAllowed, false);
  assert.equal(verifySponsorship(userOp([encodeErc1155Buy(order(RESOURCES, '33'), buyer)]), { ...config, items: parseSponsorItems(`${RESOURCES}:*`) }).isAllowed, true);
  assert.equal(verifySponsorship(userOp([encodeErc1155Buy(order(RESOURCES), buyer), blocked]), config).isAllowed, false);
});

test('fails closed on anything it cannot inspect', () => {
  const ok = encodeErc1155Buy(order(RESOURCES), buyer);
  assert.equal(verifySponsorship({ ...userOp([ok]), chainId: 202601 }, config).isAllowed, false);
  assert.equal(verifySponsorship({ chainId: 2020, userOp: { sender: buyer, targets: [ok.to] } }, config).isAllowed, false);
  assert.equal(verifySponsorship(userOp([{ ...ok, to: RESOURCES }]), config).isAllowed, false);
  assert.equal(verifySponsorship(userOp([{ ...ok, data: `${ok.data.slice(0, 10)}00` }]), config).isAllowed, false);
  assert.equal(verifySponsorship(userOp([{ to: buyer, data: '0x', value: 1 }]), config).isAllowed, false);
});

test('verifier route requires the shared secret header', async t => {
  const app = createApi({ store: {}, jwtIssuer: { jwks: { keys: [] } }, origins: [], sponsor: { ...config, secret: 's3cret' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const call = headers => fetch(`http://127.0.0.1:${server.address().port}/api/thirdweb/verify-transaction`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(userOp([encodeErc1155Buy(order(RESOURCES), buyer)])) }).then(r => r.json());
  assert.equal((await call({})).isAllowed, false);
  assert.equal((await call({ 'x-verifier-secret': 'wrong' })).isAllowed, false);
  assert.equal((await call({ 'x-verifier-secret': 's3cret' })).isAllowed, true);
});
