const Database = require('better-sqlite3');
const path = require('path');

/**
 * SQLite driver — wraps better-sqlite3 (sync) in an async-compatible interface.
 */
class SqliteDriver {
  constructor(dbPath) {
    const resolvedPath = path.resolve(__dirname, '../..', dbPath);
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async get(sql, params = []) {
    return this.db.prepare(sql).get(...params) || null;
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async run(sql, params = []) {
    const result = this.db.prepare(sql).run(...params);
    return { changes: result.changes };
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async transaction(fn) {
    const tx = this.db.transaction(() => {
      // The fn receives a "client" that has sync-looking run/get methods
      // but since we're inside a sqlite transaction, we use sync calls directly
      const client = {
        run: (sql, params = []) => this.db.prepare(sql).run(...params),
        get: (sql, params = []) => this.db.prepare(sql).get(...params) || null,
        all: (sql, params = []) => this.db.prepare(sql).all(...params),
      };
      return fn(client);
    });
    return tx();
  }

  /** Check if a column exists (SQLite-specific, used for migrations) */
  hasColumn(table, column) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === column);
  }

  /** Check column properties (SQLite-specific, used for migrations) */
  getColumnInfo(table, column) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.find(c => c.name === column) || null;
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteDriver };
