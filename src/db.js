const config = require('./config');
const { initSchema } = require('./db/schema');

/**
 * Database abstraction layer.
 *
 * Exports a unified async interface that works with both SQLite and PostgreSQL.
 * The driver is selected by DB_TYPE env var ('sqlite' or 'postgres').
 *
 * API:
 *   db.get(sql, [params])        → single row or null
 *   db.all(sql, [params])        → array of rows
 *   db.run(sql, [params])        → { changes }
 *   db.exec(sql)                 → void
 *   db.transaction(fn)           → runs fn(client) in a transaction
 *   db.init()                    → initialize schema + start cleanup jobs
 *
 * SQL uses ? placeholders everywhere. The postgres driver auto-converts to $1, $2, ...
 *
 * SQLite-specific SQL:
 *   - INSERT OR IGNORE   → use insertIgnore() helper
 *   - unixepoch()        → use nowEpoch() helper
 */

let driver = null;

const db = {
  async get(sql, params = []) {
    return driver.get(sql, params);
  },

  async all(sql, params = []) {
    return driver.all(sql, params);
  },

  async run(sql, params = []) {
    return driver.run(sql, params);
  },

  async exec(sql) {
    return driver.exec(sql);
  },

  async transaction(fn) {
    return driver.transaction(fn);
  },

  /** SQL for "insert or ignore" — differs between SQLite and Postgres */
  insertIgnore(table, columns, placeholders) {
    if (config.DB_TYPE === 'postgres') {
      return `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    }
    return `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${placeholders})`;
  },

  /** SQL for current unix epoch — differs between SQLite and Postgres */
  nowEpoch() {
    if (config.DB_TYPE === 'postgres') {
      return "EXTRACT(EPOCH FROM NOW())::INTEGER";
    }
    return "unixepoch()";
  },

  /** Initialize the database: create driver, init schema, start cleanup jobs */
  async init() {
    if (config.DB_TYPE === 'postgres') {
      const { PostgresDriver } = require('./db/postgres');
      driver = new PostgresDriver(config.DATABASE_URL);
      console.log('[db] Using PostgreSQL');
    } else {
      const { SqliteDriver } = require('./db/sqlite');
      driver = new SqliteDriver(config.DB_PATH);
      console.log('[db] Using SQLite');
    }

    await initSchema(driver, config.DB_TYPE);

    // Cleanup stale undelivered messages (older than 30 days)
    async function cleanupStaleMessages() {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
      const result = await db.run(
        'DELETE FROM messages WHERE timestamp < ? AND delivered = 0',
        [thirtyDaysAgo]
      );
      if (result.changes > 0) {
        console.log(`[cleanup] Deleted ${result.changes} stale undelivered messages`);
      }
    }

    // Cleanup retired codes older than 24 hours
    async function cleanupRetiredCodes() {
      const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
      await db.run('DELETE FROM retired_codes WHERE retired_at < ?', [oneDayAgo]);
    }

    await cleanupStaleMessages();
    await cleanupRetiredCodes();
    setInterval(cleanupStaleMessages, 24 * 60 * 60 * 1000);
    setInterval(cleanupRetiredCodes, 60 * 60 * 1000);
  },
};

module.exports = db;
