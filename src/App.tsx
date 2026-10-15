import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { ronin } from 'wagmi/chains';
import { FirebaseWallet } from './FirebaseWallet';

export function App() {
  const { address, isConnected, isReconnecting, chainId } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError, reset: resetSwitch } = useSwitchChain();
  const [copyStatus, setCopyStatus] = useState('Copy address');
  const busy = isPending || isReconnecting;
  const wrongChain = isConnected && chainId !== ronin.id;
  const connectionError = error || switchError;

  async function copyAddress() {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopyStatus('Copied'); }
    catch { setCopyStatus('Copy failed — select address below'); }
  }

  return <div className="shell">
    <header><a href="/" className="brand"><img src="/stash.svg" alt=""/>Stash<span>connect lab</span></a><span className="tag">PROOF OF CONCEPT</span></header>
    <main>
      <section className="intro"><div className="eyebrow"><span/> RONIN × PRIVY</div><h1>Your Stash.<br/>One connection.</h1><p>Bring your Ronin Stash wallet with you.<br/>Connect securely with your email or social account.</p><div className="steps"><span>01&nbsp; Connect</span><i>→</i><span>02&nbsp; Approve in Stash</span><i>→</i><span>03&nbsp; Ready</span></div></section>
      <div className="wallet-demos"><FirebaseWallet /><section className="wallet-card" aria-label="Wallet connection">
        <div className="card-top"><img src="/stash.svg" alt=""/><span className={isConnected ? 'status connected' : 'status'}><span/>{isConnected ? 'Connected' : busy ? 'Connecting' : 'Not connected'}</span></div>
        <h2>{isConnected ? 'You’re connected.' : 'Connect Ronin Stash'}</h2>
        <p>{isConnected ? 'Your wallet is available to this app.' : 'Approve this connection in the Ronin Stash window to share your wallet address.'}</p>
        {isConnected && address ? <>
          <div className="address"><label>WALLET ADDRESS</label><code>{address}</code></div>
          <div className="network"><span>Current network</span><strong>{chainId === ronin.id ? 'Ronin' : `Chain ${chainId ?? 'unknown'}`}</strong></div>
          {wrongChain && <button className="primary" disabled={switching} onClick={() => switchChain({ chainId: ronin.id })}>{switching ? 'Switching…' : 'Switch to Ronin'}</button>}
          <button className="primary" onClick={copyAddress}>{copyStatus}</button>
          <div className="actions"><a href={`${ronin.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">View on explorer ↗</a><button onClick={() => { disconnect(); reset(); resetSwitch(); setCopyStatus('Copy address'); }}>Disconnect</button></div>
        </> : <button className="primary" disabled={busy || !connectors[0]} onClick={() => { reset(); connect({ connector: connectors[0] }); }}>{busy ? 'Waiting for Stash…' : 'Connect wallet'}<span aria-hidden="true">↗</span></button>}
        <div role="status" aria-live="polite">{busy && <p className="hint">Complete the approval in the pop-up. Allow pop-ups for this site if it does not appear.</p>}</div>
        {isPending && <div className="actions"><button onClick={() => window.location.reload()}>Cancel and reset connection</button></div>}
        {connectionError && <p className="error" role="alert">{connectionError.message.split('\n')[0]} Try connecting again and allow the Stash pop-up.</p>}
        <div className="card-footer"><span>◎</span> Powered by Privy global wallets</div>
      </section></div>
    </main>
    <footer><span>RONIN STASH / CONNECTION POC</span><a href="https://wallet.roninchain.com" target="_blank" rel="noreferrer">Open Ronin Wallet ↗</a></footer>
  </div>;
}
