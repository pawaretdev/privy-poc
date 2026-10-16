import express from 'express';
import { isAddress, timingSafeEqual } from './util.mjs';
import { selectUserWallet } from './privy.mjs';
import { cheapestErc1155Order, encodeErc1155Buy, verifySponsorship } from './mavisMarket.mjs';

export function createApi({ store, verifyToken, getPrivyUser, appId, origins, configurationError, jwtIssuer, thirdweb = { configurationError: 'Missing server configuration: THIRDWEB_JWT_AUDIENCE' }, sponsor = { secret: '', chainId: 2020, items: [] }, market = { cheapestErc1155Order } }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => res.json({ ready: !configurationError, message: configurationError || 'Local API ready' }));
  app.get('/api/.well-known/jwks.json', (_req, res) => res.json(jwtIssuer.jwks));
  // Shared Firebase gate; `persist` = create/load the local user row (thirdweb POC stores nothing).
  const firebaseGate = (error, persist = true) => async (req, res, next) => {
    try {
      if (req.headers.origin && !origins.includes(req.headers.origin)) return res.status(403).json({ message: 'Origin not allowed' });
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ message: 'Firebase ID token required' });
      if (error) return res.status(503).json({ message: error });
      let claims;
      try { claims = await verifyToken(token); } catch { return res.status(401).json({ message: 'Firebase token invalid, expired, revoked, or user disabled' }); }
      req.firebaseUid = claims.uid;
      if (persist) req.accountUser = store.user(claims);
      next();
    } catch (error) { next(error); }
  };
  // Independent of Privy config; sub is always the verified Firebase UID, never a browser-supplied value.
  app.post('/api/auth/thirdweb-jwt', firebaseGate(thirdweb.configurationError, false), (req, res) => req.firebaseUid ? res.json({ token: jwtIssuer.issue(req.firebaseUid, thirdweb.audience), expires_in: 300 }) : res.status(401).json({ message: 'Firebase UID missing' }));
  // thirdweb server verifier (dashboard → Gas Sponsorship). Authenticated by a custom header set in the dashboard.
  app.post(['/api/thirdweb/verify-transaction', '/api/thirdweb/verify-transaction/verify-transaction'], express.json({ limit: '256kb' }), (req, res) => {
    const result = !sponsor.secret ? { isAllowed: false, reason: 'Verifier secret not configured' }
      : !timingSafeEqual(req.get('x-verifier-secret') || '', sponsor.secret) ? { isAllowed: false, reason: 'Bad verifier secret' }
      : verifySponsorship(req.body, sponsor);
    console.log(`[sponsor] ${result.isAllowed ? 'ALLOW' : 'DENY'} ${result.reason || ''} ${JSON.stringify(req.body).slice(0, 2000)}`);
    res.json(result);
  });
  // Public listing data only; the browser still signs and sends the transaction itself.
  app.get('/api/market/buy-tx', async (req, res, next) => {
    try {
      const { collection, tokenId, buyer } = req.query;
      if (!isAddress(collection) || !isAddress(buyer) || !/^\d+$/.test(tokenId || '')) return res.status(400).json({ message: 'collection, tokenId and buyer are required' });
      const { name, order } = await market.cheapestErc1155Order(collection, tokenId);
      const tx = encodeErc1155Buy(order, buyer);
      res.json({ name, to: tx.to, data: tx.data, value: tx.value.toString(), seller: order.maker });
    } catch (error) { next(error); }
  });
  app.use('/api', firebaseGate(configurationError));
  app.get('/api/me', (req, res) => res.json(store.account(req.accountUser, appId)));
  app.post('/api/auth/privy-jwt', (req, res) => res.json({ token: jwtIssuer.issue(req.accountUser.user_id), expires_in: 300 }));
  // Never accept a UID/address/wallet ID from the browser for the mapping.
  app.post('/api/wallet/sync', async (req, res, next) => {
    try {
      const user = await getPrivyUser(req.accountUser.user_id);
      const wallet = selectUserWallet(user, req.accountUser.user_id);
      res.json(store.saveWallet(req.accountUser, appId, user.id, wallet));
    } catch (error) { next(error); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ message: 'Endpoint not found' }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.status ? error.message : 'Local API failed. Check configuration and database availability.' }));
  return app;
}
