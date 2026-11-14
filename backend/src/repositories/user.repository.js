// src/repositories/user.repository.js
//
// Raw SQL for the users table. Same role as url.repository.js: the only
// place SQL for this table lives.

const { pool } = require('../config/db');

/**
 * Inserts a user. Email uniqueness is enforced by the UNIQUE constraint
 * on users.email, not by a check-then-insert in application code (which
 * would race under concurrent registrations). A duplicate surfaces as a
 * PostgreSQL error with code 23505, which the service translates to 409.
 */
async function createUser({ name, email, passwordHash }) {
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [name, email, passwordHash]
  );
  return result.rows[0];
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT id, name, email, password_hash
     FROM users
     WHERE email = $1`,
    [email]
  );
  return result.rows[0];
}

module.exports = { createUser, findByEmail };
