import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { config } from './config';
import { App } from './App';
import '@rainbow-me/rainbowkit/styles.css';
import './style.css';

const client = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><WagmiProvider config={config}><QueryClientProvider client={client}>
    <RainbowKitProvider theme={darkTheme({ accentColor: '#c2f281', accentColorForeground: '#152622', borderRadius: 'medium' })}>
      <App />
    </RainbowKitProvider>
  </QueryClientProvider></WagmiProvider></React.StrictMode>,
);
