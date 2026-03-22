const { Pool } = require('pg');

/**
 * PostgreSQL driver — uses pg Pool with the same async interface as SqliteDriver.
 * Accepts SQL with ? placeholders and auto-converts to $1, $2, ... for pg.
 */
class PostgresDriver {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  /** Convert ? placeholders to $1, $2, ... for pg */
  _convertPlaceholders(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async get(sql, params = []) {
    const result = await this.pool.query(this._convertPlaceholders(sql), params);
    return result.rows[0] || null;
  }

  async all(sql, params = []) {
    const result = await this.pool.query(this._convertPlaceholders(sql), params);
    return result.rows;
  }

  async run(sql, params = []) {
    const result = await this.pool.query(this._convertPlaceholders(sql), params);
    return { changes: result.rowCount };
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txClient = {
        run: async (sql, params = []) => {
          const result = await client.query(this._convertPlaceholders(sql), params);
          return { changes: result.rowCount };
        },
        get: async (sql, params = []) => {
          const result = await client.query(this._convertPlaceholders(sql), params);
          return result.rows[0] || null;
        },
        all: async (sql, params = []) => {
          const result = await client.query(this._convertPlaceholders(sql), params);
          return result.rows;
        },
      };
      const result = await fn(txClient);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresDriver };
