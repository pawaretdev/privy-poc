import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { PrivyProvider, useCreateWallet, usePrivy, useUser, useSubscribeToJwtAuthWithFlag } from '@privy-io/react-auth';
import { createPublicClient, formatEther, http } from 'viem';
import { ronin, saigon } from 'viem/chains';
import { firebaseAuth, missingClientConfig } from './firebase';

const saigonClient = createPublicClient({ chain: saigon, transport: http(import.meta.env.VITE_SAIGON_RPC_URL || undefined) });

type Account = {
  user: { id: number; uuid: string; user_id: string; email: string };
  wallet: unknown;
  ronin_wallet: unknown;
  privy_wallet: null | { wallet_address: string; privy_wallet_id: string; privy_user_id: string };
};

async function api(user: User, path: string, method = 'GET'): Promise<Account> {
  const response = await fetch(path, { method, headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Local API failed');
  return data;
}

export function FirebaseWallet() {
  if (missingClientConfig.length) return <section className="wallet-card firebase-card"><div className="eyebrow">FIREBASE + YOUR WALLET</div><h2>Sign in once. Get your wallet.</h2><p>Fill in the Firebase and Privy settings in .env, then restart the app.</p><code className="missing-config">{missingClientConfig.join('\n')}</code><button className="primary" disabled>Sign in with Google</button></section>;
  return <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID} clientId={import.meta.env.VITE_PRIVY_CLIENT_ID || undefined} config={{ defaultChain: ronin, supportedChains: [ronin], embeddedWallets: { ethereum: { createOnLogin: 'off' } } }}><WalletFlow /></PrivyProvider>;
}

function SaigonBalance({ address }: { address: `0x${string}` }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => saigonClient.getBalance({ address }).then(
      value => { if (active) { setBalance(value); setError(''); } },
      () => { if (active) setError('Unable to read Saigon balance. Retrying…'); },
    );
    setBalance(null); void load();
    // Poll so a faucet/transfer shows up without a manual refresh.
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [address, refresh]);
  const [whole, fraction = ''] = balance === null ? [] : formatEther(balance).split('.');
  return <div className="address">
    <label>BALANCE · {saigon.name.toUpperCase()}</label>
    <code title={balance === null ? undefined : `${formatEther(balance)} RON`}>{balance === null ? (error ? '—' : 'Loading…') : `${whole}${fraction ? `.${fraction.slice(0, 6)}` : ''} RON`}</code>
    {error && <p className="hint">{error}</p>}
    <div className="actions"><button onClick={() => setRefresh(v => v + 1)}>Refresh balance</button><a href={`${saigon.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer">View on explorer ↗</a></div>
  </div>;
}

function WalletFlow() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('Sign in to create or restore your wallet.');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const { ready, authenticated, user, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { createWallet } = useCreateWallet();
  const inFlight = useRef<Promise<void> | null>(null);
  const generation = useRef(0);

  useEffect(() => onIdTokenChanged(firebaseAuth!, next => {
    generation.current += 1;
    setFirebaseUser(next); setAccount(null); setError(''); setLoading(false);
  }, () => { setLoading(false); setError('Unable to read Firebase session.'); }), []);
  const getExternalJwt = useCallback(async () => {
    if (!firebaseUser) return undefined;
    try {
      const response = await fetch('/api/auth/privy-jwt', { method: 'POST', headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Identity bridge failed');
      if (firebaseAuth!.currentUser?.uid !== firebaseUser.uid) return undefined;
      return result.token as string;
    } catch (e) { setError(e instanceof Error ? e.message : 'Identity bridge failed'); throw e; }
  }, [firebaseUser]);
  useSubscribeToJwtAuthWithFlag({ isAuthenticated: !!firebaseUser, isLoading: loading, getExternalJwt });

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    api(firebaseUser, '/api/me').then(value => { if (active) setAccount(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [firebaseUser, retry]);

  useEffect(() => {
    if (!firebaseUser || !ready || !authenticated || !user) return;
    const uid = firebaseUser.uid;
    // Wait for Privy to catch up on account switches before creating anything.
    if (user.linkedAccounts.find(a => a.type === 'custom_auth')?.customUserId !== uid) return;
    let active = true;
    const version = generation.current;
    async function provision() {
      setBusy(true); setError('');
      try {
        // Serialize same-origin tabs; SDK's default createWallet refuses a second wallet.
        const run = async () => {
          if (inFlight.current) await inFlight.current.catch(() => {});
          if (!active || generation.current !== version) return;
          const operation = async () => {
            await api(firebaseUser!, '/api/me');
            const current = await refreshUser();
            if (firebaseAuth!.currentUser?.uid !== uid || generation.current !== version || current?.linkedAccounts.find(a => a.type === 'custom_auth')?.customUserId !== uid) throw new Error('Account changed. Retry wallet setup.');
            const existing = current.linkedAccounts.some(a => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'ethereum');
            if (!existing) { setMessage('Creating your wallet…'); await createWallet(); }
            else setMessage('Restoring your wallet…');
            if (firebaseAuth!.currentUser?.uid !== uid || generation.current !== version) return;
            setMessage('Verifying and saving wallet…');
            const saved = await api(firebaseUser!, '/api/wallet/sync', 'POST');
            if (active && generation.current === version) { setAccount(saved); setMessage('Your wallet is ready.'); }
          };
          const promise = operation(); inFlight.current = promise;
          try { await promise; } finally { if (inFlight.current === promise) inFlight.current = null; }
        };
        if (navigator.locks) await navigator.locks.request(`privy-wallet:${import.meta.env.VITE_PRIVY_APP_ID}:${uid}`, run);
        else await run();
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Wallet setup failed'); }
      finally { if (active) setBusy(false); }
    }
    void provision();
    return () => { active = false; };
    // SDK functions can change identity during creation; only restart on identity or explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, ready, authenticated, user?.id, user?.linkedAccounts.find(a => a.type === 'custom_auth')?.customUserId, retry]);

  async function login() {
    setError(''); setBusy(true);
    try { await signInWithPopup(firebaseAuth!, new GoogleAuthProvider()); setMessage('Connecting your wallet…'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Google login failed'); }
    finally { setBusy(false); }
  }
  async function exit() {
    generation.current += 1; setAccount(null); setError(''); setBusy(true);
    try { await signOut(firebaseAuth!); await logout(); setMessage('Signed out.'); }
    catch { setError('Sign out was incomplete. Reload and try again.'); }
    finally { setBusy(false); }
  }
  const visibleAccount = account?.user.user_id === firebaseUser?.uid ? account : null;
  return <section className="wallet-card firebase-card">
    <div className="eyebrow">FIREBASE + YOUR WALLET</div><h2>{visibleAccount?.privy_wallet ? 'Your account is ready.' : 'Sign in once. Get your wallet.'}</h2>
    <p>Use your Google account. We’ll create your embedded wallet once and restore it on your next visit.</p>
    {!firebaseUser ? <button className="primary" disabled={loading || busy || !ready} onClick={login}>{loading || !ready ? 'Initializing…' : 'Sign in with Google'}</button> : <>
      <p>{firebaseUser.email}</p><div role="status">{busy ? message : visibleAccount?.privy_wallet ? 'Wallet saved to your local account.' : 'Waiting for wallet authentication…'}</div>
      {visibleAccount?.privy_wallet && <div className="address"><label>YOUR EMBEDDED WALLET · RONIN</label><code>{visibleAccount.privy_wallet.wallet_address}</code></div>}
      {visibleAccount?.privy_wallet && <SaigonBalance address={visibleAccount.privy_wallet.wallet_address as `0x${string}`} />}
      <div className="actions"><button disabled={busy} onClick={() => { setError(''); setRetry(v => v + 1); }}>Retry / sync wallet</button><button onClick={exit}>Sign out</button></div>
      {visibleAccount && <details className="mapping"><summary>Local account & wallet mapping</summary><pre>{JSON.stringify(visibleAccount, null, 2)}</pre></details>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {firebaseUser && !authenticated && <p className="hint">If this stays pending, check Custom JWT authentication in your Privy dashboard, then sign out and retry.</p>}
    <div className="card-footer">App-owned integration · User-controlled wallet</div>
  </section>;
}
