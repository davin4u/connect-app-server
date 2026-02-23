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
    display_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    chat_public_key TEXT,
    username TEXT,
    password_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_users_contact_code ON users(contact_code);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key);

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

  CREATE TABLE IF NOT EXISTS pending_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pending_events_user ON pending_events(user_id);

  CREATE TABLE IF NOT EXISTS retired_codes (
    code TEXT PRIMARY KEY,
    retired_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Migration: add chat_public_key column if missing (for existing installs)
try {
  db.exec('ALTER TABLE users ADD COLUMN chat_public_key TEXT');
} catch {
  // Column already exists
}

// Migration: make username and password_hash nullable (they may already be nullable from CREATE)
// No ALTER needed since SQLite doesn't enforce NOT NULL on existing rows for added columns

// Create unique index on chat_public_key if not exists
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chat_public_key ON users(chat_public_key)');
} catch {
  // Index may already exist
}

// Cleanup stale undelivered messages (older than 30 days)
function cleanupStaleMessages() {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const result = db.prepare('DELETE FROM messages WHERE timestamp < ? AND delivered = 0').run(thirtyDaysAgo);
  if (result.changes > 0) {
    console.log(`[cleanup] Deleted ${result.changes} stale undelivered messages`);
  }
}

// Cleanup retired codes older than 24 hours
function cleanupRetiredCodes() {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  db.prepare('DELETE FROM retired_codes WHERE retired_at < ?').run(oneDayAgo);
}

cleanupStaleMessages();
cleanupRetiredCodes();
setInterval(cleanupStaleMessages, 24 * 60 * 60 * 1000);
setInterval(cleanupRetiredCodes, 60 * 60 * 1000);

module.exports = db;
