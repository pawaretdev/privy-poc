import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {
    db,
    user(claims) {
      if (!claims.uid || !claims.email) throw Object.assign(new Error('Firebase account must have an email.'), { status: 422 });
      const provider = claims.firebase?.sign_in_provider || 'unknown';
      db.prepare(`INSERT INTO user (uuid,email,user_id,display_name,provider_identity,sign_in_provider)
        VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING`).run(
        randomUUID(), claims.email, claims.uid, claims.name || '',
        claims.firebase?.identities?.[provider]?.[0] || claims.uid, provider,
      );
      return db.prepare('SELECT * FROM user WHERE user_id = ?').get(claims.uid);
    },
    account(user, appId, thirdwebClientId = '') {
      return {
        user,
        wallet: db.prepare('SELECT * FROM wallet WHERE user_id = ?').get(user.id) || null,
        ronin_wallet: db.prepare('SELECT * FROM ronin_wallet WHERE user_id = ?').get(user.id) || null,
        privy_wallet: db.prepare('SELECT * FROM privy_wallet WHERE user_id = ? AND privy_app_id = ?').get(user.id, appId) || null,
        thirdweb_wallet: db.prepare('SELECT * FROM thirdweb_wallet WHERE user_id = ? AND thirdweb_client_id = ?').get(user.id, thirdwebClientId) || null,
      };
    },
    saveWallet(user, appId, privyUserId, wallet) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT * FROM privy_wallet WHERE user_id = ? AND privy_app_id = ?').get(user.id, appId);
        if (current && (current.privy_wallet_id !== wallet.id || current.privy_user_id !== privyUserId || current.wallet_address.toLowerCase() !== wallet.address.toLowerCase())) {
          throw Object.assign(new Error('A different wallet is already mapped. Manual review required.'), { status: 409 });
        }
        if (!current) db.prepare(`INSERT INTO privy_wallet (user_id,privy_app_id,privy_user_id,privy_wallet_id,wallet_address,chain_type)
          VALUES (?,?,?,?,?,'ethereum')`).run(user.id, appId, privyUserId, wallet.id, wallet.address.toLowerCase());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if (error.code?.startsWith('ERR_SQLITE')) throw Object.assign(new Error('Wallet mapping conflicts with an existing account.'), { status: 409 });
        throw error;
      }
      return this.account(user, appId);
    },
    // Same first-write-wins rule as Privy: never silently remap a user to a different thirdweb wallet.
    saveThirdwebWallet(user, appId, clientId, wallet) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT * FROM thirdweb_wallet WHERE user_id = ? AND thirdweb_client_id = ?').get(user.id, clientId);
        if (current && (current.thirdweb_user_id !== wallet.userId || current.wallet_address.toLowerCase() !== wallet.address)) {
          throw Object.assign(new Error('A different thirdweb wallet is already mapped. Manual review required.'), { status: 409 });
        }
        if (!current) db.prepare(`INSERT INTO thirdweb_wallet (user_id,thirdweb_client_id,thirdweb_user_id,wallet_address)
          VALUES (?,?,?,?)`).run(user.id, clientId, wallet.userId, wallet.address);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        if (error.code?.startsWith('ERR_SQLITE')) throw Object.assign(new Error('thirdweb wallet mapping conflicts with an existing account.'), { status: 409 });
        throw error;
      }
      return this.account(user, appId, clientId);
    },
  };
}
