# Firebase + thirdweb in-app wallet setup

A separate page, `/thirdweb.html`, tests the same Firebase Google login against a **thirdweb in-app wallet** (SDK v5, pinned to `thirdweb@5.121.6`) instead of Privy. Its purpose is to compare the user flow and cost per MAU with the Privy card on `/`. The Privy and Stash cards are unchanged.

Flow: Google sign-in (Firebase) → `POST /api/auth/thirdweb-jwt` (server verifies the Firebase ID token and issues a 5-minute RS256 JWT with `sub` = Firebase UID) → `inAppWallet().connect({ strategy: 'jwt' })` → wallet address → optional gas-sponsored 0-value test transaction on Ronin mainnet.

## Environment

Add to `.env` (or `.env.local`) and restart `npm run dev`:

| Variable | Where | Value |
| --- | --- | --- |
| `VITE_THIRDWEB_CLIENT_ID` | public | Client ID of your thirdweb project. Never put the thirdweb **secret key** in a `VITE_*` variable. |
| `THIRDWEB_SECRET_KEY` | server only | Project secret key. Only `POST /api/thirdweb/wallet/sync` uses it, to look the wallet up in thirdweb and confirm it belongs to the Firebase UID before saving it. Without it, login and transactions still work, but the wallet is not saved (503). |
| `VITE_THIRDWEB_EXECUTION_MODE` | public, optional | `7702` (default) or `4337`. See [Execution mode](#execution-mode). |
| `THIRDWEB_JWT_AUDIENCE` | server only, optional | `aud` claim of the bridge JWT. Must equal the dashboard **AUD value**. Defaults to `VITE_THIRDWEB_CLIENT_ID`. |
| `VITE_FIREBASE_*`, `FIREBASE_*` | as before | Same Firebase project and service account as the Privy card ([Firebase setup](firebase-setup.md)). |
| `PRIVY_JWT_ISSUER` | server | Reused as the JWT `iss`. The thirdweb bridge also reuses the same signing key (`data/privy-jwt-private.pem`) and the same JWKS URL. |

The thirdweb endpoint does **not** require the Privy variables. With Privy unconfigured, the Privy endpoints still return their 503 error. If Firebase Admin credentials or the audience are missing, `/api/auth/thirdweb-jwt` returns 503 with the missing names. The page itself lists missing public variables, just as the Privy card does.

The two bridges use different audiences (Privy app ID vs thirdweb AUD), so a token minted for one provider is rejected by the other.

## thirdweb dashboard (before trying it)

1. Create a project at [thirdweb.com/dashboard](https://thirdweb.com/dashboard) and copy its **Client ID** into `VITE_THIRDWEB_CLIENT_ID`.
2. Under the project's settings, restrict the client ID's **allowed domains** to `localhost:8000` and `fe.pawaret.uk` (use `127.0.0.1:8000` as well if you open the page that way). The dashboard asks for domains, not full origins.
3. Open **Wallets → In-App Wallets → Configuration**, enable **Custom authentication (JWT / OIDC-compatible)**, and set:
   - **JWKS URI**: `https://fe.pawaret.uk/api/.well-known/jwks.json` (the tunnel and the local API must be running so thirdweb can fetch it)
   - **AUD value**: the same string as `THIRDWEB_JWT_AUDIENCE`, or your client ID if you left that unset.
   thirdweb derives the wallet from the JWT `sub` claim, which is the Firebase UID.
4. Enable **gas sponsorship** for the project (Account Abstraction / Gas Sponsorship). Add **sponsorship rules**: allow only chain `2020` (Ronin), and set a low global spend limit, plus optional per-user limits. Mainnet sponsorship requires a **paid plan with billing** attached. Without it, the test transaction fails with a paymaster or bundler error.
5. Optional: under **Wallets → Users**, verify that a user with the Firebase UID appears after the first sign-in.

## Execution mode

The default is **EIP-7702** (`executionMode: { mode: 'EIP7702', sponsorGas: true }`). The user keeps the plain EOA address. The first sponsored transaction includes an authorization that delegates the EOA to thirdweb's minimal account.

Evidence for Ronin (checked 2026-10-15):

- Ronin's Kotaro hard fork ("Feather Fan" upgrade, block 46,557,383) shipped all of Pectra's execution-layer EIPs, including EIP-7702 ([Ronin blog](https://blog.roninchain.com/p/feather-fan-upgrade)). Ronin mainnet is past that block.
- `https://api.thirdweb.com/v1/chains/2020/services` reports `account-abstraction: enabled`. The same call for `202601` (Saigon) reports it as disabled.
- `https://2020.bundler.thirdweb.com/v2` asks for a client ID, so the chain is served. `https://202601.bundler.thirdweb.com/v2` returns `Invalid chain: 202601`.
- ERC-4337 EntryPoint v0.6/v0.7 and thirdweb's default account factories have code on Ronin mainnet.

**Verified (2026-10-16, with the project client ID):** `tw_getDelegationContract` on chain 2020 returns `0x3E515544F8d8293B0A353E10Ff3b7ca03b52f35b`, and `eth_supportedEntryPoints` returns EntryPoint v0.6 and v0.7. The same calls on `202601` return `Invalid chain: 202601`. The dashboard's sponsorship-policy chain picker lists Ronin Saigon Testnet (202601), but that list contains every chain thirdweb knows about. It does not mean the chain is served. **End-to-end test passed on mainnet (2026-10-16):** tx [`0x1e6357ec…2e29`](https://app.roninchain.com/tx/0x1e6357ec3dce0e6ade3542ed7871efa2604b0c4c75d5204ef4aed97ad7c02e29) is a type-4 (7702) transaction sent by a thirdweb executor. The user EOA held 0 RON and is now delegated to `0x3E51…f35b`. Gas used was 84,968 (about 0.0018 RON), billed to the project's sponsorship credit. If the 7702 transaction still fails with a delegation or bundler error, set `VITE_THIRDWEB_EXECUTION_MODE=4337` and restart.

**ERC-4337** (`executionMode: { mode: 'EIP4337', smartAccount: { chain: ronin, sponsorGas: true } }`) uses a smart-account address that differs from the in-app EOA. The page shows both addresses. The smart account is deployed on the first transaction, and that deployment is also sponsored.

## Known limits

- **Saigon testnet is not supported** by thirdweb's bundler and paymaster: the bundler rejects chain 202601, and AA is disabled for it. The sponsored test therefore runs on **Ronin mainnet** and consumes real sponsorship credit, although the transaction sends 0 RON to the user's own address. To try Saigon anyway, for example after thirdweb enables it, set `VITE_THIRDWEB_CHAIN=202601`. Also add Ronin Saigon Testnet to the sponsorship policy's chain list.
- **Wallet mapping:** after connecting, the page calls `POST /api/thirdweb/wallet/sync` with the in-app EOA address as a hint. The server queries thirdweb's user-details API (`queryBy=walletAddress`, the same call as the SDK's server-only `getUser`). It saves the row in `thirdweb_wallet` only if that user has a JWT profile whose id equals the verified Firebase UID. The same first-write-wins and no-remap rules as `privy_wallet` apply. **Not yet verified against the live API:** the exact profile type/field names for custom-JWT users. The code accepts `jwt`/`custom_jwt` with `details.id`/`sub`/`userId`. If the real response differs, the sync returns 403 and lists the profile types it saw.
- Each page load or account switch logs into thirdweb again with a fresh bridge JWT. Sign out runs Firebase `signOut` and the in-app wallet `disconnect`. Neither revokes thirdweb sessions elsewhere.
- A real Google login and a sponsored 7702 transaction on Ronin mainnet were run on 2026-10-16 (see [Execution mode](#execution-mode)). The wallet sync has only been tested with mocked thirdweb responses so far.

## Compared with the Privy POC (`/`)

| | Privy card | thirdweb page |
| --- | --- | --- |
| Identity bridge | `/api/auth/privy-jwt`, aud = Privy app ID | `/api/auth/thirdweb-jwt`, aud = thirdweb AUD; same key, issuer, and JWKS |
| Wallet creation | Explicit `createWallet()` after JWT sync, with a lock across tabs | Implicit on the first `connect({ strategy: 'jwt' })`; deterministic per `sub` |
| Server secret | `PRIVY_APP_SECRET`, used to verify the wallet server-side | `THIRDWEB_SECRET_KEY`, used the same way |
| Persistence | `privy_wallet` mapping in local SQLite | `thirdweb_wallet` mapping in the same SQLite |
| Test network | Saigon balance read only | Ronin mainnet sponsored transaction (7702 or 4337) |
| Gas sponsorship | Not part of the POC | Built in (`sponsorGas`), billed to the thirdweb project |
| Billing to compare | Privy MAU pricing | thirdweb in-app wallet MAU pricing plus sponsored gas. See [thirdweb pricing](https://thirdweb.com/pricing) and [Privy pricing](https://www.privy.io/pricing) for current numbers. |

## Verification

`npm test` covers the new endpoint:

- It rejects requests without a Firebase token, with an invalid token, or from a disallowed origin.
- It returns 503 when unconfigured.
- It signs `sub` from the verified Firebase UID only, ignoring forged body fields, with the thirdweb `aud`.
- The JWT verifies against the shared JWKS.
- It works while the Privy configuration is missing, and the Privy endpoints still return 503.
- It creates no `user` rows. Only the wallet sync creates or loads the `user` row.
- The wallet sync (`tests/thirdweb-wallet.test.mjs`) saves only when thirdweb ties the address to the same Firebase UID. It rejects another user's address (403), unknown wallets (409), bad input (400) and untrusted origins (403). It never remaps an existing mapping (409), and it reports a missing secret key without calling thirdweb (503).

`npm run build` type-checks and builds both `index.html` and `thirdweb.html`.

## References

- [thirdweb custom auth (JWT)](https://portal.thirdweb.com/wallets/custom-auth)
- [thirdweb sponsor gas](https://portal.thirdweb.com/transactions/sponsor)
- [thirdweb EIP-7702 in-app wallets](https://portal.thirdweb.com/changelog/next-gen-smart-accounts)
- [Ronin Feather Fan / Kotaro upgrade](https://blog.roninchain.com/p/feather-fan-upgrade)

## Server verifier (Mavis Market buy test)

The project's sponsorship can be used by any of its signed-in users, from the browser console as well as from your UI. Restricting it to a contract does not help either: every Mavis Market buy goes through the same gateway (`0x3b3a…3fe3`). The server verifier decodes each call and sponsors only:

- a 0-RON self-transfer (the "Send sponsored test tx" button)
- Mavis Market buys (`interactWith("ERC1155_EXCHANGE" | "ORDER_EXCHANGE", settle…)`) whose order assets are all in `THIRDWEB_SPONSOR_ITEMS`. Each entry is `0xCollection:tokenId`, or `0xCollection:*` for a whole collection. The default is Chicken Saga Resources #32 only.

Anything it cannot decode is denied.

Setup:
1. In `.env`, set `THIRDWEB_VERIFIER_SECRET`.
2. In the dashboard, go to Wallets → Gas Sponsorship → server verifier. Set the URL to `https://fe.pawaret.uk/api/thirdweb/verify-transaction` and add a custom header `x-verifier-secret: <same value>`.
3. Make sure chain 2020 is allowed in the chain restriction.

Each decision is logged by the API process as a `[sponsor] ALLOW|DENY …` line. On the thirdweb page, the Mavis Market section buys 1 unit each of Resources #32 (should be sponsored), Resources #33 (same collection, should be denied) and Game Items #1 (`0xc5da…b53c`, should be denied). The item price is paid in RON from the wallet, so fund it with about 0.03 RON first. Otherwise the Game Items buy fails for lack of funds and the test proves nothing about the verifier.
