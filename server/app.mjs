import express from 'express';
import { selectUserWallet } from './privy.mjs';

export function createApi({ store, verifyToken, getPrivyUser, appId, origins, configurationError, jwtIssuer }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => res.json({ ready: !configurationError, message: configurationError || 'Local API ready' }));
  app.get('/api/.well-known/jwks.json', (_req, res) => res.json(jwtIssuer.jwks));
  app.use('/api', async (req, res, next) => {
    try {
      if (req.headers.origin && !origins.includes(req.headers.origin)) return res.status(403).json({ message: 'Origin not allowed' });
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ message: 'Firebase ID token required' });
      if (configurationError) return res.status(503).json({ message: configurationError });
      let claims;
      try { claims = await verifyToken(token); } catch { return res.status(401).json({ message: 'Firebase token invalid, expired, revoked, or user disabled' }); }
      req.accountUser = store.user(claims);
      next();
    } catch (error) { next(error); }
  });
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
