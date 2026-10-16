// Server-side counterpart of server/privy.mjs: find the thirdweb in-app wallet user and prove it belongs to the Firebase UID.
const USER_DETAILS = 'https://embedded-wallet.thirdweb.com/api/2023-11-30/embedded-wallet/user-details';
// thirdweb names the custom-JWT login profile differently across APIs; match any of them on the JWT `sub`.
const JWT_PROFILE_TYPES = new Set(['jwt', 'custom_jwt', 'custom-jwt', 'customjwt']);

// Same endpoint and headers as the SDK's server-only getUser() (thirdweb/wallets), without pulling the SDK into the API.
export async function lookupThirdwebUser({ clientId, secretKey }, walletAddress) {
  const url = new URL(USER_DETAILS);
  url.searchParams.set('queryBy', 'walletAddress');
  url.searchParams.set('walletAddress', walletAddress);
  const response = await fetch(url, { headers: { 'x-secret-key': secretKey, ...(clientId ? { 'x-client-id': clientId } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error(`Unable to verify wallet with thirdweb (${response.status}). Check THIRDWEB_SECRET_KEY.`), { status: 424 });
  const users = await response.json();
  return Array.isArray(users) ? users[0] || null : null;
}

// The browser only supplies an address hint; thirdweb's record must tie that address to this Firebase UID.
export function selectThirdwebWallet(user, firebaseUid, walletAddress) {
  if (!user) throw Object.assign(new Error('thirdweb wallet not found. Connect the wallet first, then retry.'), { status: 409 });
  const profiles = user.linkedAccounts || user.profiles || [];
  const jwtProfiles = profiles.filter(p => JWT_PROFILE_TYPES.has(String(p.type).toLowerCase()));
  const subs = jwtProfiles.flatMap(p => [p.details?.id, p.details?.sub, p.details?.userId]).filter(Boolean);
  if (!subs.includes(firebaseUid)) {
    const seen = profiles.map(p => p.type).join(', ') || 'none';
    throw Object.assign(new Error(`thirdweb identity does not match Firebase UID (profiles: ${seen}).`), { status: 403 });
  }
  if (!user.userId || String(user.walletAddress).toLowerCase() !== walletAddress.toLowerCase()) throw Object.assign(new Error('thirdweb wallet metadata is incomplete.'), { status: 409 });
  return { userId: user.userId, address: user.walletAddress.toLowerCase(), smartAccountAddress: user.smartAccountAddress?.toLowerCase() || null };
}
