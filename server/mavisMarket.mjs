import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, parseAbiParameters } from 'viem';

// Mavis (Ronin) Market on mainnet; addresses from @sky-mavis/mavis-market-core, ABIs from the Sourcify-verified sources.
export const MARKET_GATEWAY = '0x3b3adf1422f84254b7fbb0e7ca62bd0865133fe3';
const RON_PAYMENT_TOKEN = '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4'; // WRON; the gateway accepts native RON as msg.value
const GRAPHQL = 'https://marketplace-graphql.skymavis.com/graphql';
const ZERO = '0x0000000000000000000000000000000000000000';

const gatewayAbi = parseAbi(['function interactWith(string interfaceName, bytes data) payable']);
const settle = '(bytes orderData, bytes signature, address referralAddr, uint256 expectedState, address recipient, address refunder)';
// Both exchanges share function names but differ in argument lists; they are delegatecalled through the gateway.
const erc1155ExchangeAbi = parseAbi([
  `function settleOrder(${settle} settleInfo, uint256 settleQuantity, uint256 settlePrice) payable`,
  `function swapRONAndSettleOrder(${settle} settleInfo, uint256 settleQuantity, uint256 deadline, address[] path) payable`,
  `function swapTokensAndSettleOrder(${settle} settleInfo, uint256 settleQuantity, uint256 settlePrice, uint256 deadline, address[] path)`,
]);
const erc721ExchangeAbi = parseAbi([
  `function settleOrder(${settle} settleInfo, uint256 settlePrice) payable`,
  `function swapRONAndSettleOrder(${settle} settleInfo, uint256 deadline, address[] path) payable`,
  `function swapTokensAndSettleOrder(${settle} settleInfo, uint256 settlePrice, uint256 deadline, address[] path)`,
]);
const asset = '(uint8 erc, address addr, uint256 id, uint256 quantity)';
const erc1155Order = parseAbiParameters(`(address maker, uint8 kind, ${asset} asset, uint256 expiredAt, address paymentToken, uint256 startedAt, uint256 unitPrice, uint256 endedAt, uint256 endedUnitPrice, uint256 expectedState, uint256 nonce)`);
const erc721Order = parseAbiParameters(`(address maker, uint8 kind, ${asset}[] assets, uint256 expiredAt, address paymentToken, uint256 startedAt, uint256 basePrice, uint256 endedAt, uint256 endedPrice, uint256 expectedState, uint256 nonce, uint256 marketFeePercentage)`);
const ERC = { Erc20: 0, Erc721: 1, Erc1155: 2 };
const ORDER_KIND = { Offer: 0, Sell: 1 };

const ORDERS_QUERY = `query($tokenAddress: String!, $tokenId: BigDecimal!) {
  erc1155Token(tokenAddress: $tokenAddress, tokenId: $tokenId) {
    name
    orders(from: 0, size: 1, showInvalid: false, sort: PriceAsc) {
      maker kind expiredAt paymentToken startedAt basePrice expectedState nonce signature currentPrice orderStatus
      assets { erc address id quantity }
      orderQuantity { availableQuantity }
    }
  }
}`;

export async function cheapestErc1155Order(collection, tokenId, fetchImpl = fetch) {
  const response = await fetchImpl(GRAPHQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: ORDERS_QUERY, variables: { tokenAddress: collection.toLowerCase(), tokenId: String(tokenId) } }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors) throw Object.assign(new Error(body.errors?.[0]?.message || `Mavis Market API failed (${response.status})`), { status: 424 });
  const token = body.data?.erc1155Token;
  const order = token?.orders?.[0];
  if (!order || order.orderStatus !== 'OPEN') throw Object.assign(new Error('No open listing for this token'), { status: 404 });
  return { name: token.name, order };
}

// Mirrors the SDK's settleErc1155Order when paying with RON: msg.value = unit price × quantity.
export function encodeErc1155Buy(order, buyer, quantity = 1n) {
  if (order.paymentToken.toLowerCase() !== RON_PAYMENT_TOKEN) throw Object.assign(new Error('Only RON-priced listings are supported'), { status: 400 });
  const [item] = order.assets;
  const orderData = encodeAbiParameters(erc1155Order, [{
    maker: order.maker, kind: ORDER_KIND[order.kind], asset: { erc: ERC[item.erc], addr: item.address, id: BigInt(item.id), quantity: BigInt(item.quantity) },
    expiredAt: BigInt(order.expiredAt), paymentToken: order.paymentToken, startedAt: BigInt(order.startedAt), unitPrice: BigInt(order.basePrice),
    endedAt: 0n, endedUnitPrice: 0n, expectedState: BigInt(order.expectedState), nonce: BigInt(order.nonce),
  }]);
  const value = BigInt(order.currentPrice) * quantity;
  const settleInfo = { orderData, signature: order.signature, referralAddr: ZERO, expectedState: BigInt(order.expectedState), recipient: buyer, refunder: buyer };
  const inner = encodeFunctionData({ abi: erc1155ExchangeAbi, functionName: 'settleOrder', args: [settleInfo, quantity, value] });
  return { to: MARKET_GATEWAY, data: encodeFunctionData({ abi: gatewayAbi, functionName: 'interactWith', args: ['ERC1155_EXCHANGE', inner] }), value };
}

// Returns the NFTs ({ collection, tokenId }) a gateway call trades; throws for anything it cannot fully decode.
export function marketAssets(callData) {
  const { args: [interfaceName, data] } = decodeFunctionData({ abi: gatewayAbi, data: callData });
  const [abi, orderType, assets] = interfaceName === 'ERC1155_EXCHANGE' ? [erc1155ExchangeAbi, erc1155Order, o => [o.asset]]
    : interfaceName === 'ORDER_EXCHANGE' ? [erc721ExchangeAbi, erc721Order, o => o.assets]
    : [];
  if (!abi) throw new Error(`Unsupported market interface ${interfaceName}`);
  const { args: [settleInfo] } = decodeFunctionData({ abi, data });
  const [order] = decodeAbiParameters(orderType, settleInfo.orderData);
  return assets(order).map(a => ({ collection: getAddress(a.addr), tokenId: a.id.toString() }));
}

// "0xCollection:32,0xOther:*" → allowlist entries; `*` allows every token of that collection.
export function parseSponsorItems(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [collection, tokenId] = entry.split(':');
    if (!/^0x[0-9a-fA-F]{40}$/.test(collection) || !/^(\d+|\*)$/.test(tokenId || '')) throw new Error(`Invalid sponsor item "${entry}" (expected 0xCollection:tokenId or 0xCollection:*)`);
    return { collection: getAddress(collection), tokenId };
  });
}

// thirdweb server verifier: sponsor only self-test calls and market buys of allowlisted items. Fail closed.
export function verifySponsorship(body, { chainId, items }) {
  const isAllowed = a => items.some(i => i.collection === a.collection && (i.tokenId === '*' || i.tokenId === a.tokenId));
  if (Number(body?.chainId) !== chainId) return { isAllowed: false, reason: `Chain ${body?.chainId} is not sponsored` };
  const op = body?.userOp || {};
  const { targets, callDatas, values = [] } = op.data || {};
  if (!Array.isArray(targets) || !Array.isArray(callDatas) || !targets.length || targets.length !== callDatas.length) return { isAllowed: false, reason: 'Call data missing; cannot inspect transaction' };
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]?.toLowerCase();
    const data = callDatas[i] || '0x';
    if (op.sender && target === op.sender.toLowerCase() && data === '0x' && BigInt(values[i] || 0) === 0n) continue;
    if (target !== MARKET_GATEWAY) return { isAllowed: false, reason: `Contract ${targets[i]} is not sponsored` };
    let traded;
    try { traded = marketAssets(data); } catch (e) { return { isAllowed: false, reason: `Unrecognized market call: ${e.message.split('\n')[0]}` }; }
    const blocked = traded.find(a => !isAllowed(a));
    if (blocked) return { isAllowed: false, reason: `Item ${blocked.collection}#${blocked.tokenId} is not sponsored` };
  }
  return { isAllowed: true };
}
