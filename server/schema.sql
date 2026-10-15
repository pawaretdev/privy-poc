-- SQLite simulation only, not a production migration.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  provider_identity TEXT NOT NULL,
  sign_in_provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES user(id),
  wallet_address TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ronin_wallet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES user(id),
  wallet_address TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS privy_wallet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id),
  privy_app_id TEXT NOT NULL,
  privy_user_id TEXT NOT NULL,
  privy_wallet_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL COLLATE NOCASE,
  chain_type TEXT NOT NULL CHECK(chain_type = 'ethereum'),
  default_chain_id INTEGER NOT NULL DEFAULT 2020,
  ownership TEXT NOT NULL DEFAULT 'user-controlled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, privy_app_id, chain_type),
  UNIQUE(privy_app_id, privy_wallet_id),
  UNIQUE(privy_app_id, privy_user_id, chain_type),
  UNIQUE(privy_app_id, wallet_address)
);
