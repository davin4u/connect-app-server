/**
 * Database schema initialization — dialect-aware for SQLite and PostgreSQL.
 */

function getCreateTableSQL(dbType) {
  const isPostgres = dbType === 'postgres';

  // Timestamp default differs between SQLite and PostgreSQL
  const nowDefault = isPostgres
    ? "EXTRACT(EPOCH FROM NOW())::INTEGER"
    : "unixepoch()";

  return `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      contact_code TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      chat_public_key TEXT,
      username TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (${nowDefault})
    );

    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
      created_at INTEGER NOT NULL DEFAULT (${nowDefault}),
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
      timestamp INTEGER NOT NULL DEFAULT (${nowDefault}),
      delivered INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS retired_codes (
      code TEXT PRIMARY KEY,
      retired_at INTEGER NOT NULL DEFAULT (${nowDefault})
    );
  `;
}

function getCreateIndexesSQL() {
  return `
    CREATE INDEX IF NOT EXISTS idx_users_contact_code ON users(contact_code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_chat_public_key ON users(chat_public_key);
    CREATE INDEX IF NOT EXISTS idx_messages_receiver_delivered ON messages(receiver_id, delivered);
    CREATE INDEX IF NOT EXISTS idx_pending_events_user ON pending_events(user_id);
  `;
}

/**
 * Run SQLite-specific migrations (column additions, table rebuilds).
 * PostgreSQL doesn't need these since we create the final schema directly.
 */
async function runSqliteMigrations(driver) {
  // Migration: add chat_public_key column if missing
  if (!driver.hasColumn('users', 'chat_public_key')) {
    await driver.exec('ALTER TABLE users ADD COLUMN chat_public_key TEXT');
    console.log('[migration] Added chat_public_key column');
  }

  // Migration: make username and password_hash nullable
  const usernameCol = driver.getColumnInfo('users', 'username');
  if (usernameCol && usernameCol.notnull === 1) {
    await driver.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        contact_code TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        chat_public_key TEXT,
        username TEXT,
        password_hash TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO users_new (id, contact_code, display_name, public_key, chat_public_key, username, password_hash, created_at)
        SELECT id, contact_code, display_name, public_key, chat_public_key, username, password_hash, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE INDEX idx_users_contact_code ON users(contact_code);
      CREATE UNIQUE INDEX idx_users_public_key ON users(public_key);
      CREATE UNIQUE INDEX idx_users_chat_public_key ON users(chat_public_key);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    console.log('[migration] Made username and password_hash columns nullable');
  }
}

async function initSchema(driver, dbType) {
  // Create tables
  const stmts = getCreateTableSQL(dbType).split(';').filter(s => s.trim());
  for (const stmt of stmts) {
    await driver.exec(stmt + ';');
  }

  // Run SQLite-specific migrations BEFORE creating indexes
  // (migrations may add columns that indexes depend on)
  if (dbType === 'sqlite') {
    await runSqliteMigrations(driver);
  }

  // Create indexes (after migrations have added any missing columns)
  const indexes = getCreateIndexesSQL().split(';').filter(s => s.trim());
  for (const idx of indexes) {
    try {
      await driver.exec(idx + ';');
    } catch {
      // Index may already exist
    }
  }

  console.log(`[db] Schema initialized (${dbType})`);
}

module.exports = { initSchema };
