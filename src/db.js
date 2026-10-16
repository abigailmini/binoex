import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  bybit_uid       TEXT UNIQUE,          -- Bybit sub-member UID (lives under the institutional master)
  bybit_username  TEXT,
  sub_api_key     TEXT,                 -- sub-account API key (trading + read), created at registration
  sub_api_secret  TEXT,                 -- AES-256-GCM encrypted
  status          TEXT NOT NULL DEFAULT 'active',  -- active | frozen
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  coin            TEXT NOT NULL,
  chain           TEXT NOT NULL,
  address         TEXT NOT NULL,
  tag             TEXT,
  amount          TEXT NOT NULL,
  transfer_id     TEXT,                 -- universal transfer sub -> master
  bybit_withdraw_id TEXT,               -- withdraw id returned by Bybit
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | transferred | submitted | failed
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)'),
  attachBybit: db.prepare(
    'UPDATE users SET bybit_uid = ?, bybit_username = ?, sub_api_key = ?, sub_api_secret = ? WHERE id = ?'
  ),
  touchLogin: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  insertWithdrawal: db.prepare(
    'INSERT INTO withdrawals (user_id, coin, chain, address, tag, amount) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  updateWithdrawal: db.prepare(
    "UPDATE withdrawals SET status = ?, transfer_id = COALESCE(?, transfer_id), bybit_withdraw_id = COALESCE(?, bybit_withdraw_id), error = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  withdrawalsByUser: db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50'),

  audit: db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)'),
};

export function audit(userId, action, detail, ip) {
  try {
    q.audit.run(userId ?? null, action, detail ? JSON.stringify(detail) : null, ip ?? null);
  } catch (e) {
    console.error('[audit]', e.message);
  }
}
