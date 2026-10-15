import dotenv from 'dotenv';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { openStore } from './store.mjs';
import { lookupUser } from './privy.mjs';
import { createApi } from './app.mjs';
import { createJwtIssuer } from './jwt.mjs';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const env = process.env;
const missing = ['FIREBASE_PROJECT_ID', 'PRIVY_APP_ID', 'PRIVY_APP_SECRET'].filter(key => !env[key]);
if (!env.GOOGLE_APPLICATION_CREDENTIALS && (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY)) missing.push('FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or GOOGLE_APPLICATION_CREDENTIALS');
let configurationError = missing.length ? `Missing server configuration: ${missing.join(', ')}` : null;
if (env.PRIVY_APP_ID && env.PRIVY_APP_ID !== env.VITE_PRIVY_APP_ID) configurationError = 'PRIVY_APP_ID must match VITE_PRIVY_APP_ID';
if (env.FIREBASE_PROJECT_ID && env.FIREBASE_PROJECT_ID !== env.VITE_FIREBASE_PROJECT_ID) configurationError = 'FIREBASE_PROJECT_ID must match VITE_FIREBASE_PROJECT_ID';
if (env.FIREBASE_AUTH_EMULATOR_HOST) configurationError = 'Firebase Auth emulator is not enabled in this POC server';
let auth;
if (!configurationError) {
  try {
    auth = getAuth(initializeApp({ projectId: env.FIREBASE_PROJECT_ID, credential: env.FIREBASE_CLIENT_EMAIL ? cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) : applicationDefault() }));
  } catch { configurationError = 'Invalid Firebase Admin credentials'; }
}
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });
const store = openStore(`${dataDir}maxion-poc.sqlite`);
const jwtIssuer = createJwtIssuer(`${dataDir}privy-jwt-private.pem`, env.PRIVY_JWT_ISSUER || 'https://fe.pawaret.uk', env.PRIVY_APP_ID || 'unconfigured');
const api = createApi({ store, appId: env.PRIVY_APP_ID || '', origins: (env.APP_ORIGINS || 'http://localhost:8000,http://127.0.0.1:8000,https://fe.pawaret.uk').split(',').map(s => s.trim()), configurationError,
  jwtIssuer, verifyToken: token => auth.verifyIdToken(token, true), getPrivyUser: uid => lookupUser(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET, uid),
});
const server = api.listen(Number(env.API_PORT || 8001), '127.0.0.1', () => console.log(`Local API listening on ${env.API_PORT || 8001}${configurationError ? ' (configuration required)' : ''}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.db.close(); process.exit(0); }));
