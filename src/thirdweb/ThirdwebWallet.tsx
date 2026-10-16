import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createThirdwebClient, defineChain, prepareTransaction, sendTransaction } from 'thirdweb';
import { inAppWallet, type Account, type Wallet } from 'thirdweb/wallets';
import { firebaseAuth, missingFirebaseConfig } from '../firebase';

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID?.trim();
const missingConfig = [...(clientId ? [] : ['VITE_THIRDWEB_CLIENT_ID']), ...missingFirebaseConfig];
const client = clientId ? createThirdwebClient({ clientId }) : null;
const mode: '7702' | '4337' = import.meta.env.VITE_THIRDWEB_EXECUTION_MODE?.trim() === '4337' ? '4337' : '7702';
// thirdweb has no Ronin preset. As of 2026-10-16 its bundler serves 2020 but rejects Saigon (202601: "Invalid chain"),
// so sponsored txs on Saigon fail until thirdweb enables it. VITE_THIRDWEB_CHAIN=202601 lets you try anyway.
const testnet = import.meta.env.VITE_THIRDWEB_CHAIN?.trim() === '202601';
const explorer = testnet ? 'https://saigon-app.roninchain.com' : 'https://app.roninchain.com';
const ronin = testnet
  ? defineChain({ id: 202601, name: 'Ronin Saigon Testnet', nativeCurrency: { name: 'Ronin', symbol: 'RON', decimals: 18 }, blockExplorers: [{ name: 'Saigon Explorer', url: explorer }], testnet: true })
  : defineChain({ id: 2020, name: 'Ronin', nativeCurrency: { name: 'Ronin', symbol: 'RON', decimals: 18 }, blockExplorers: [{ name: 'Ronin Explorer', url: explorer }] });
const networkLabel = testnet ? 'Saigon testnet' : 'Ronin mainnet';
const createWallet = () => inAppWallet({ executionMode: mode === '7702' ? { mode: 'EIP7702', sponsorGas: true } : { mode: 'EIP4337', smartAccount: { chain: ronin, sponsorGas: true } } });
const modeLabel = mode === '7702' ? 'EIP-7702 · sponsored · same EOA address' : 'ERC-4337 smart account · sponsored';
// Mainnet Mavis Market items for the server-verifier test: only Resources #32 is in THIRDWEB_SPONSOR_ITEMS.
const marketItems = [
  { key: 'resources-32', label: 'Chicken Saga Resources #32', collection: '0xac78515ef7d0bb935bc86d4f8ce314038946b52f', tokenId: '32', expect: 'verifier should allow' },
  { key: 'resources-33', label: 'Chicken Saga Resources #33', collection: '0xac78515ef7d0bb935bc86d4f8ce314038946b52f', tokenId: '33', expect: 'same collection · verifier should deny' },
  { key: 'game-items', label: 'Chicken Saga Game Items #1', collection: '0xc5da607b372eca2794f5b5452148751c358eb53c', tokenId: '1', expect: 'verifier should deny' },
];
type TxState = { pending: boolean; hash?: string; error?: string };
const short = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback).split('\n')[0];

async function bridgeJwt(user: User) {
  const response = await fetch('/api/auth/thirdweb-jwt', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Identity bridge failed (${response.status})`);
  return result.token as string;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="shell">
    <header><a href="/thirdweb.html" className="brand"><img src="/stash.svg" alt=""/>thirdweb<span>wallet lab</span></a><span className="tag">PROOF OF CONCEPT</span></header>
    <main>
      <section className="intro"><div className="eyebrow"><span/> FIREBASE × THIRDWEB</div><h1>Sign in once.<br/>Gas on us.</h1><p>Google sign-in through your Firebase project, then a non-custodial thirdweb in-app wallet via custom JWT. Compare with the Privy card on the main page.</p><div className="steps"><span>01&nbsp; Google</span><i>→</i><span>02&nbsp; JWT bridge</span><i>→</i><span>03&nbsp; Wallet</span><i>→</i><span>04&nbsp; Sponsored tx</span></div></section>
      <div className="wallet-demos">{children}</div>
    </main>
    <footer><span>THIRDWEB / IN-APP WALLET POC</span><a href="/">← Stash &amp; Privy POC</a></footer>
  </div>;
}

export function ThirdwebPage() {
  return <Shell>{missingConfig.length ? <section className="wallet-card firebase-card"><div className="eyebrow">FIREBASE + THIRDWEB WALLET</div><h2>Sign in once. Get your wallet.</h2><p>Fill in the Firebase and thirdweb settings in .env, then restart the app.</p><code className="missing-config">{missingConfig.join('\n')}</code><button className="primary" disabled>Sign in with Google</button></section> : <WalletFlow />}</Shell>;
}

function WalletFlow() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<{ uid: string; account: Account; admin?: string } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [copyStatus, setCopyStatus] = useState('Copy address');
  const [tx, setTx] = useState<TxState>({ pending: false });
  const [buys, setBuys] = useState<Record<string, TxState>>({});
  const wallet = useRef<Wallet | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  // Serialize wallet operations: thirdweb's connector/session storage is shared per client ID.
  const enqueue = (op: () => Promise<void>) => (queue.current = queue.current.then(op, op));
  const drop = async () => { const current = wallet.current; wallet.current = null; await current?.disconnect().catch(() => {}); };

  useEffect(() => onAuthStateChanged(firebaseAuth!, next => { setFirebaseUser(next); setLoading(false); }, () => { setLoading(false); setError('Unable to read Firebase session.'); }), []);

  useEffect(() => {
    const version = ++generation.current;
    const stale = () => generation.current !== version;
    setAccount(null); setError(''); setTx({ pending: false }); setBuys({}); setCopyStatus('Copy address');
    if (!firebaseUser) { void enqueue(drop); return; }
    const uid = firebaseUser.uid;
    setMessage('Connecting your wallet…');
    void enqueue(async () => {
      if (stale()) return;
      try {
        await drop();
        const jwt = await bridgeJwt(firebaseUser);
        if (stale() || firebaseAuth!.currentUser?.uid !== uid) return;
        const next = createWallet();
        const connected = await next.connect({ client: client!, strategy: 'jwt', jwt, chain: ronin });
        wallet.current = next; // a stale result is dropped by the next queued operation
        if (stale()) return;
        setAccount({ uid, account: connected, admin: next.getAdminAccount?.()?.address });
      } catch (e) { if (!stale()) setError(short(e, 'Wallet connection failed')); }
      finally { if (!stale()) setMessage(''); }
    });
    return () => { generation.current += 1; };
  }, [firebaseUser, retry]);

  async function login() {
    setError('');
    try { await signInWithPopup(firebaseAuth!, new GoogleAuthProvider()); }
    catch (e) { setError(short(e, 'Google login failed')); }
  }
  async function exit() {
    generation.current += 1; setAccount(null); setError('');
    try { await enqueue(drop); await signOut(firebaseAuth!); }
    catch { setError('Sign out was incomplete. Reload and try again.'); }
  }
  async function copy(address: string) {
    try { await navigator.clipboard.writeText(address); setCopyStatus('Copied'); }
    catch { setCopyStatus('Copy failed — select address above'); }
  }
  async function sendTest(current: Account) {
    const version = generation.current;
    setTx({ pending: true });
    try {
      // 0-value self-transfer; gas is paid by your thirdweb sponsorship.
      const { transactionHash } = await sendTransaction({ account: current, transaction: prepareTransaction({ client: client!, chain: ronin, to: current.address, value: 0n }) });
      if (generation.current === version) setTx({ pending: false, hash: transactionHash });
    } catch (e) { if (generation.current === version) setTx({ pending: false, error: short(e, 'Transaction failed') }); }
  }

  async function buy(current: Account, item: typeof marketItems[number]) {
    const version = generation.current;
    const set = (state: TxState) => { if (generation.current === version) setBuys(prev => ({ ...prev, [item.key]: state })); };
    set({ pending: true });
    try {
      const response = await fetch(`/api/market/buy-tx?collection=${item.collection}&tokenId=${item.tokenId}&buyer=${current.address}`);
      const order = await response.json();
      if (!response.ok) throw new Error(order.message || 'Could not load listing');
      // Item price is paid from the wallet's own RON (msg.value); only gas is sponsored.
      const { transactionHash } = await sendTransaction({ account: current, transaction: prepareTransaction({ client: client!, chain: ronin, to: order.to, data: order.data, value: BigInt(order.value) }) });
      set({ pending: false, hash: transactionHash });
    } catch (e) { set({ pending: false, error: short(e, 'Purchase failed') }); }
  }

  const visible = account?.uid === firebaseUser?.uid ? account : null;
  const address = visible?.account.address;
  return <section className="wallet-card firebase-card">
    <div className="eyebrow">FIREBASE + THIRDWEB WALLET</div><h2>{address ? 'Your wallet is ready.' : 'Sign in once. Get your wallet.'}</h2>
    <p>Use your Google account. thirdweb derives the same non-custodial wallet from your Firebase UID on every visit.</p>
    {!firebaseUser ? <button className="primary" disabled={loading} onClick={login}>{loading ? 'Initializing…' : 'Sign in with Google'}</button> : <>
      <p>{firebaseUser.email}</p><div role="status">{message || (address ? 'Wallet connected.' : error ? 'Wallet not connected.' : 'Waiting for wallet…')}</div>
      {address && <>
        <div className="address"><label>YOUR THIRDWEB WALLET · {ronin.name?.toUpperCase()}</label><code>{address}</code>
          <div className="actions"><button onClick={() => copy(address)}>{copyStatus}</button><a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">View on explorer ↗</a></div></div>
        <div className="network"><span>Execution mode</span><strong>{modeLabel}</strong></div>
        {visible.admin && visible.admin.toLowerCase() !== address.toLowerCase() && <div className="network"><span>Signer (in-app EOA)</span><strong title={visible.admin}>{visible.admin.slice(0, 6)}…{visible.admin.slice(-4)}</strong></div>}
        <button className="primary" disabled={tx.pending} onClick={() => sendTest(visible.account)}>{tx.pending ? 'Sending…' : `Send sponsored test tx · ${networkLabel}`}</button>
        <p className="hint">Sends 0 RON to your own address. Gas is billed to the thirdweb project’s sponsorship credit.</p>
        {tx.hash && <p className="hint sign-result" role="status">Sent: <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.hash} ↗</a></p>}
        {tx.error && <p className="error" role="alert">Sponsored transaction failed: {tx.error}</p>}
        {!testnet && <div className="address"><label>MAVIS MARKET · SPONSORED BUY TEST</label>
          <p className="hint">Buys 1 unit of the cheapest listing. Price is paid in RON from this wallet; gas is sponsored only if the server verifier allows it.</p>
          {marketItems.map(item => { const state = buys[item.key] || { pending: false }; return <div key={item.key}>
            <div className="actions"><button disabled={state.pending} onClick={() => buy(visible.account, item)}>{state.pending ? 'Buying…' : `Buy ${item.label}`}</button><span className="hint">{item.expect}</span></div>
            {state.hash && <p className="hint sign-result" role="status">Bought: <a href={`${explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer">{state.hash} ↗</a></p>}
            {state.error && <p className="error" role="alert">{item.label}: {state.error}</p>}
          </div>; })}
        </div>}
      </>}
      <div className="actions"><button disabled={!!message} onClick={() => setRetry(v => v + 1)}>Retry wallet connection</button><button onClick={exit}>Sign out</button></div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {firebaseUser && error && <p className="hint">Check the thirdweb custom JWT settings (JWKS URI and AUD value) and allowed domains, then retry.</p>}
    <div className="card-footer">thirdweb in-app wallet · Custom JWT · No database</div>
  </section>;
}
