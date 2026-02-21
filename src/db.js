const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const dbPath = path.resolve(__dirname, '..', config.DB_PATH);
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    contact_code TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_users_contact_code ON users(contact_code);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

  CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, contact_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (contact_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
    delivered INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_receiver_delivered
    ON messages(receiver_id, delivered);
`);

module.exports = db;
