import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const missingClientConfig = ['VITE_PRIVY_APP_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].filter(key => !import.meta.env[key]?.trim());
export const firebaseAuth = missingClientConfig.length ? null : getAuth(initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}));
