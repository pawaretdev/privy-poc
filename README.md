# Ronin Stash connection POC

**Summary docs (Thai), including a checklist for taking this to production:** [Privy](docs/privy-integration.md) · [thirdweb](docs/thirdweb-integration.md)

## New: Firebase Google login + your own Privy embedded wallet

See [Firebase setup](docs/firebase-setup.md) for credentials, required Privy JWT dashboard configuration, and the Maxion-shaped local database. The new card automatically creates/restores a wallet after Firebase login and saves a verified mapping in a separate `privy_wallet` table. The original Stash connector below remains independent.

Fill `.env` using `.env.example`, then `npm run dev` starts both frontend (:8000) and local API (:8001). Node.js 22.13+ is required. Run `npm test` for API/database tests. No production Maxion database is connected or migrated.

**thirdweb comparison:** `/thirdweb.html` signs in with the same Firebase project and connects a non-custodial thirdweb in-app wallet (custom JWT) with a gas-sponsored Ronin mainnet test transaction. See [thirdweb setup](docs/thirdweb-setup.md).

React + TypeScript + Vite frontend that connects an existing **Ronin Stash global wallet** through Privy's cross-app connector. No backend or app secret is required for this connector flow.

## Run

Requires Node.js 22.13+.

```sh
npm install
npm run dev
```

Open http://localhost:8000 and click **Connect wallet**. Allow pop-ups, log in to Ronin Stash, and approve sharing your wallet. The app displays your address and current network, with copy, explorer, network-switch, and disconnect controls.

```sh
npm run build
npm run preview
```

## Configuration

The default public provider App ID is `cmpkwmb7l001c0bjp3sdn6n8e`. It was found in Ronin Wallet's published frontend and verified against `https://auth.privy.io/api/v1/apps/cmpkwmb7l001c0bjp3sdn6n8e` on 2026-10-15: the returned application name was **Ronin Stash** and custom API domain was `https://privy.wallet.roninchain.com`.

This public ID is not a secret. It identifies the provider wallet, not an app you create in your own Privy dashboard. Provider configuration can change; confirm this ID with Sky Mavis before production integration.

Optional overrides: copy `.env.example` to `.env.local`, edit `VITE_STASH_APP_ID` or `VITE_RONIN_RPC_URL`, and restart Vite. Never put an app secret or private key in a `VITE_*` variable.

The app registers only the Stash connector, disables injected-wallet discovery, and targets the Ronin chain definition from viem. RainbowKit's `projectId` value is metadata required by its configuration API; no WalletConnect connector is installed in the wallet list.

## How it works

1. `src/config.ts` creates `toPrivyWallet({ id: stashAppId, name: 'Ronin Stash' })` and passes it through RainbowKit to wagmi.
2. The connect button invokes wagmi's `connect` directly from the click handler, allowing the SDK to open its authorization pop-up.
3. Stash owns login and consent. wagmi exposes the resulting wallet address and chain to the frontend.
4. Disconnect clears the application's wallet connection. It does not log the user out of the Stash website or revoke permissions there.

This POC does not migrate Waypoint assets, create an unrelated app-owned embedded wallet, send transactions, or implement server authentication. A connected address alone is not a server-authenticated session. A production login flow should use a server-issued challenge and verify the signature.

## Manual acceptance checks

- Connect opens the Ronin Stash login/consent flow.
- Approving shows the actual address; closing/rejecting allows retry and shows an error when the SDK reports it.
- Reload restores the connection when the SDK has a valid session.
- Copy copies the full address; explorer opens the same address.
- A different active chain offers Switch to Ronin and reports rejected switches.
- Disconnect returns to the connect screen; reconnect works.
- Check a narrow mobile viewport and keyboard focus.

Full login/consent requires a real Stash account. The POC does not claim end-to-end wallet verification until that manual step is completed.

## References

- [Ronin Waypoint → Stash notice](https://docs.skymavis.com/mavis/ronin-waypoint/overview)
- [Privy global wallets](https://docs.privy.io/wallets/global-wallets/overview)
- [Privy RainbowKit connector guide](https://docs.privy.io/wallets/global-wallets/integrate-a-global-wallet/rainbowkit-connector)
- [Ronin Wallet](https://wallet.roninchain.com)
