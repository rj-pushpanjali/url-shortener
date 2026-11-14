// scripts/migrate.js
//
// Simple, dependency-free SQL migration runner.
//
// What it does:
//   1. Ensures the `schema_migrations` tracking table exists (by running
//      001_create_schema_migrations_table.sql first, unconditionally).
//   2. Reads all *.sql files in migrations/, sorted by filename (hence the
//      NNN_ numeric prefixes — that's what defines execution order).
//   3. Skips any filename already recorded in schema_migrations.
//   4. Runs each remaining file's SQL inside a transaction, then records
//      the filename in schema_migrations, so re-running this script is
//      always safe (idempotent) — already-applied migrations are no-ops.
//
// This intentionally has no "down"/rollback migrations. For a fresher-level
// project, forward-only migrations are simpler to reason about and explain;
// rollbacks would double the number of files without adding learning value
// for this project's goals.
//
// Usage: node scripts/migrate.js   (or npm run migrate)

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const BOOTSTRAP_FILE = '001_create_schema_migrations_table.sql';

async function getAppliedMigrations(client) {
  // schema_migrations may not exist yet on a brand-new database — that's
  // expected and fine, it just means "nothing has been applied".
  try {
    const result = await client.query('SELECT filename FROM schema_migrations');
    return new Set(result.rows.map((row) => row.filename));
  } catch (err) {
    if (err.code === '42P01') {
      // undefined_table
      return new Set();
    }
    throw err;
  }
}

async function runMigrationFile(client, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    logger.info(`[migrate] Applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[migrate] Failed: ${filename}`);
    throw err;
  }
}

async function migrate() {
  const client = await pool.connect();

  try {
    const allFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // relies on the NNN_ numeric prefix for ordering

    // Bootstrap step: always attempt to create schema_migrations first
    // (CREATE TABLE IF NOT EXISTS makes this safe to repeat).
    if (allFiles.includes(BOOTSTRAP_FILE)) {
      await runMigrationFileIfNotApplied(client, BOOTSTRAP_FILE);
    }

    const applied = await getAppliedMigrations(client);

    for (const filename of allFiles) {
      if (filename === BOOTSTRAP_FILE) continue; // already handled above
      if (applied.has(filename)) {
        logger.info(`[migrate] Skipping (already applied): ${filename}`);
        continue;
      }
      await runMigrationFile(client, filename);
    }

    logger.info('[migrate] All migrations up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

async function runMigrationFileIfNotApplied(client, filename) {
  const applied = await getAppliedMigrations(client);
  if (applied.has(filename)) {
    logger.info(`[migrate] Skipping (already applied): ${filename}`);
    return;
  }
  await runMigrationFile(client, filename);
}

migrate().catch((err) => {
  logger.error('[migrate] Migration run failed:', err);
  process.exit(1);
});
