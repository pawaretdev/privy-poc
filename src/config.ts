import { toPrivyWalletConnector } from '@privy-io/cross-app-connect/rainbow-kit';
import { createConfig, http, type CreateConnectorFn } from 'wagmi';
import { ronin } from 'wagmi/chains';

export const stashAppId = import.meta.env.VITE_STASH_APP_ID?.trim() || 'cmpkwmb7l001c0bjp3sdn6n8e';

// Connector shape suggested by a Ronin community admin: Stash is a Privy global wallet,
// registered directly in wagmi (no RainbowKit wallet list) and reported as 'injected'.
export function roninStashConnector(): CreateConnectorFn {
  const base = toPrivyWalletConnector({ id: stashAppId, name: 'Ronin Stash', iconUrl: '/stash.svg' });
  return params => ({ ...base(params), type: 'injected' });
}

export const config = createConfig({
  chains: [ronin],
  connectors: [roninStashConnector()],
  multiInjectedProviderDiscovery: false,
  transports: { [ronin.id]: http(import.meta.env.VITE_RONIN_RPC_URL || undefined) },
});
