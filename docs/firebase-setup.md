# Firebase + Privy setup

This is a separate flow from the existing Ronin Stash connector. Your own Privy application creates a user-controlled EVM wallet. Logging into the same Google account does **not** automatically reuse a Ronin Stash wallet from another Privy app.

## Environment

Copy values from `.env.example` into `.env` (or `.env.local`), without overwriting any existing credentials. Node.js 22.13+ is required for the local SQLite API; tested runtime is Node 24.

- `VITE_PRIVY_APP_ID` and `PRIVY_APP_ID`: the same **your own** Privy application ID.
- `PRIVY_APP_SECRET`: server-only secret for fetching verified user/wallet metadata. Never use `VITE_` for this.
- `VITE_FIREBASE_*`: your Firebase Web app configuration (the Maxion Firebase project if that is the identity source you want to test).
- `FIREBASE_PROJECT_ID`: must match `VITE_FIREBASE_PROJECT_ID`.
- `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`: service-account credentials, or use `GOOGLE_APPLICATION_CREDENTIALS` pointing to a JSON file outside the repo instead. For inline PEM use quoted `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`.

Only Firebase Authentication is used. The POC does not connect to Maxion's MySQL, Firestore, or production account API. Signing into a real Firebase project still uses its real identity service and can create a Firebase Auth user if that Google account has not signed in before.

## Firebase Console

1. Enable Google under Authentication → Sign-in method.
2. Add `localhost`, `127.0.0.1` (if using it), and `fe.pawaret.uk` under Authentication → Settings → Authorized domains.
3. Use the project's supplied `authDomain` (normally `<project-id>.firebaseapp.com`); do not substitute `fe.pawaret.uk` unless custom auth-domain hosting is configured.

## Privy Dashboard — required before login can work

1. Enable/request **Custom authentication**, then open Authentication → JWT integration. This feature may require access from Privy.
2. Enable client-side JWT authentication for the React SDK.
3. Set JWT ID claim to `sub` (Firebase UID).
4. Configure the POC bridge JWKS endpoint: `https://fe.pawaret.uk/api/.well-known/jwks.json`. Keep the tunnel/server running so Privy can fetch it. The endpoint only exposes the public RSA key.
5. JWT ID claim is `sub`; the bridge signs verified Firebase UID as the subject. Its issuer is `PRIVY_JWT_ISSUER` and audience is your Privy App ID. The private signing key is generated once in `data/privy-jwt-private.pem` (mode 0600). Keep it across restarts; deleting it rotates the key and may require Privy to refresh its JWKS cache. The bridge is used because Firebase signing keys are shared across projects: the backend first verifies the correct project, expiration, revocation, and disabled-user status, then issues a 5-minute app-scoped JWT. Never configure Google's shared JWKS as a substitute for this bridge.
6. Add the application's origins (`http://localhost:8000`, `http://127.0.0.1:8000`, `https://fe.pawaret.uk`) to allowed origins. If using an app client, put its ID in `VITE_PRIVY_CLIENT_ID`.
7. Enable Ethereum embedded wallets. The client explicitly creates the default wallet after JWT synchronization; `createOnLogin` is off because custom login does not trigger modal-based automatic creation.
8. Keep user-controlled ownership, without delegated/session signers for this test. No signing keys or server transaction endpoint are configured by the POC.

## Run

```sh
npm install
npm run dev
```

This starts Vite on 8000 and a loopback API on 8001, proxied through `/api`. Restart after editing credentials. The existing Stash demo still works when Firebase/Privy settings are blank; the new card lists missing public config.

## Database simulation

`data/maxion-poc.sqlite` is created locally. It contains a relevant subset of the current Maxion schema:

| Table | Identity / relationship |
| --- | --- |
| `user` | `id` is internal numeric ID; `user_id` is unique Firebase UID; UUID, email, name, provider fields mirror Maxion |
| `wallet` | Legacy wallet/MetaMask-style binding with unique FK `user_id → user.id` |
| `ronin_wallet` | Legacy Ronin binding with unique FK `user_id → user.id` |
| `privy_wallet` | New embedded-wallet mapping with FK `user_id → user.id`, Privy app/user/wallet IDs, address, chain type |

The original schema also has `maxion_wallet`; this POC does not copy that feature or unrelated game/profile/2FA tables. Existing Maxion rows are not imported. After a real Firebase login, the local `user` row is created using the same UID lookup concept as `registerNewUser`.

`privy_wallet` is unique per local user + Privy app + chain type. The EVM wallet is usable across EVM networks; `default_chain_id=2020` only records Ronin as the initial target. We do not create a separate private key for every chain.

The SDK checks refreshed linked accounts and creates the default wallet only when absent. Same-origin Web Locks serialize creation across tabs; the SDK refuses default-wallet duplication. The API uses atomic unique constraints for mapping and refuses silent address replacement. Failed mapping can be retried without creating another wallet. Existing legacy table values are untouched.

## Trust boundary

Every account request verifies the Firebase token using Admin SDK with revocation/disabled-user checks. The server uses the verified UID to retrieve the Privy user by custom-auth ID, checks the returned identity, and selects a non-imported, non-delegated embedded Ethereum wallet. The browser never supplies the UID, wallet ID, or address to persist. Tokens, private keys, and app secrets are not stored in SQLite. The bridge signing key lives in the ignored data directory and is blocked from Vite file serving.

The service account can perform sensitive Firebase operations, but this POC only verifies ID tokens. Sign out clears the local sessions; it does not revoke all Firebase sessions or delete any wallet. Wallet ownership and recovery ultimately depend on your Privy dashboard configuration.

## Verification

`npm test` tests token rejection, user isolation, repeated/concurrent mapping, identity mismatch, legacy-wallet preservation, duplicate ownership, and retry after upstream failures using mocked identity services and in-memory SQLite. `npm run build` checks TypeScript and builds the frontend.

Real Google login, wallet creation, reload/re-login, and mapping still need your configured credentials and enabled Privy JWT integration. Transaction signing and gas sponsorship are outside this increment.

## References

- [Privy custom JWT setup](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/setup)
- [Privy JWT state synchronization](https://docs.privy.io/authentication/user-authentication/jwt-based-auth/usage)
- [Automatic creation limitations](https://docs.privy.io/basics/react/advanced/automatic-wallet-creation)
- [Server lookup by custom auth ID](https://docs.privy.io/api-reference/users/get-by-custom-auth)
- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
