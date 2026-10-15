import { toPrivyWallet } from '@privy-io/cross-app-connect/rainbow-kit';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { ronin } from 'wagmi/chains';

export const stashAppId = import.meta.env.VITE_STASH_APP_ID?.trim() || 'cmpkwmb7l001c0bjp3sdn6n8e';
const connectors = connectorsForWallets([
  { groupName: 'Ronin', wallets: [toPrivyWallet({ id: stashAppId, name: 'Ronin Stash', iconUrl: '/stash.svg' })] },
], {
  appName: 'Ronin Stash POC',
  // Required RainbowKit metadata. This app has no WalletConnect connector.
  projectId: 'ronin-stash-poc',
});

export const config = createConfig({
  chains: [ronin],
  connectors,
  multiInjectedProviderDiscovery: false,
  transports: { [ronin.id]: http(import.meta.env.VITE_RONIN_RPC_URL || undefined) },
});
