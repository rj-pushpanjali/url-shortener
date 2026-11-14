// src/config/db.js
//
// Creates and exports a single shared PostgreSQL connection pool.
// Every repository in the app will import { pool } from here rather than
// creating its own connection — this keeps connection management in one place.

const { Pool } = require('pg');
const logger = require('../utils/logger');

// If DATABASE_URL is set, prefer it (common in hosted/Docker environments).
// Otherwise fall back to individual PG* fields from .env.
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });

// Fired if an idle client in the pool hits an unexpected error
// (e.g. the database restarts). Without this handler, such an error
// would crash the whole Node process.
pool.on('error', (err) => {
  logger.error('[postgres] Unexpected error on idle client', err);
});

/**
 * Quick connectivity check used at startup and by /health.
 * Runs a trivial query so we know the pool can actually reach PostgreSQL,
 * not just that the Pool object was constructed.
 */
async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

module.exports = { pool, testConnection };
