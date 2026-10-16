export function selectUserWallet(privyUser, firebaseUid) {
  if (!privyUser.linked_accounts?.some(a => a.type === 'custom_auth' && a.custom_user_id === firebaseUid)) {
    throw Object.assign(new Error('Privy identity does not match Firebase UID.'), { status: 403 });
  }
  const wallets = privyUser.linked_accounts.filter(a => a.type === 'wallet' && a.wallet_client_type === 'privy' && a.chain_type === 'ethereum' && !a.imported && !a.delegated);
  if (wallets.length === 0) throw Object.assign(new Error('Embedded wallet is not ready. Retry after creation completes.'), { status: 409 });
  if (wallets.length !== 1) throw Object.assign(new Error('Multiple embedded wallets found. Choose a wallet policy before linking.'), { status: 409 });
  const wallet = wallets[0];
  if (!privyUser.id || !wallet.id || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) throw Object.assign(new Error('Privy wallet metadata is incomplete.'), { status: 409 });
  return wallet;
}

export async function lookupUser(appId, appSecret, uid) {
  const response = await fetch('https://api.privy.io/v1/users/custom_auth/id', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`, 'privy-app-id': appId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_user_id: uid }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'Privy identity is not ready. Complete wallet setup and retry.' : 'Unable to verify wallet with Privy. Check server configuration.'), { status: response.status === 404 ? 409 : 424 });
  return response.json();
}
