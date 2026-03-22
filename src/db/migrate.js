#!/usr/bin/env node

/**
 * One-time migration script: SQLite → PostgreSQL
 *
 * Usage:
 *   DB_PATH=./data/messenger.db DATABASE_URL=postgres://user:pass@localhost:5432/faceless node src/db/migrate.js
 *
 * This script:
 *   1. Reads all data from the SQLite database
 *   2. Creates the schema in PostgreSQL (if not exists)
 *   3. Inserts all rows into PostgreSQL
 *   4. Reports row counts for verification
 *
 * Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { SqliteDriver } = require('./sqlite');
const { PostgresDriver } = require('./postgres');
const { initSchema } = require('./schema');

const DB_PATH = process.env.DB_PATH || './data/messenger.db';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

async function migrate() {
  console.log('=== SQLite → PostgreSQL Migration ===\n');

  // Connect to both databases
  console.log(`[sqlite] Opening ${DB_PATH}`);
  const sqlite = new SqliteDriver(DB_PATH);

  console.log(`[postgres] Connecting to ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  const pg = new PostgresDriver(DATABASE_URL);

  // Initialize PostgreSQL schema
  console.log('[postgres] Creating schema...');
  await initSchema(pg, 'postgres');

  // Migrate each table
  const tables = ['users', 'contacts', 'messages', 'pending_events', 'retired_codes'];

  for (const table of tables) {
    console.log(`\n--- Migrating: ${table} ---`);

    // Read all rows from SQLite
    const rows = await sqlite.all(`SELECT * FROM ${table}`);
    console.log(`[sqlite] ${rows.length} rows found`);

    if (rows.length === 0) {
      console.log(`[skip] No data to migrate`);
      continue;
    }

    // Get column names from first row
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const conflictColumn = getConflictColumn(table);

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const values = columns.map(col => row[col]);
      try {
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictColumn}) DO NOTHING`;
        const result = await pg.run(sql, values);
        if (result.changes > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`[error] Failed to insert row in ${table}:`, err.message);
        console.error('  Row:', JSON.stringify(row).slice(0, 200));
        skipped++;
      }
    }

    console.log(`[postgres] ${inserted} inserted, ${skipped} skipped (already exist)`);
  }

  // Verify row counts
  console.log('\n=== Verification ===');
  for (const table of tables) {
    const sqliteCount = await sqlite.get(`SELECT COUNT(*) as count FROM ${table}`);
    const pgCount = await pg.get(`SELECT COUNT(*) as count FROM ${table}`);
    const match = sqliteCount.count === parseInt(pgCount.count)  ? '✓' : '✗ MISMATCH';
    console.log(`  ${table}: SQLite=${sqliteCount.count}, Postgres=${pgCount.count} ${match}`);
  }

  // Cleanup
  sqlite.close();
  await pg.close();
  console.log('\n=== Migration complete ===');
}

function getConflictColumn(table) {
  switch (table) {
    case 'users': return 'id';
    case 'contacts': return 'user_id, contact_id';
    case 'messages': return 'id';
    case 'pending_events': return 'id';
    case 'retired_codes': return 'code';
    default: return 'id';
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
