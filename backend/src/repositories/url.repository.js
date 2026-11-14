// src/repositories/url.repository.js
//
// The only layer allowed to write raw SQL against url_mapping. Services
// call these functions and never see a SQL string or a `pg` client
// directly — that separation is what lets services stay focused on
// business logic (Section 2 of the approved architecture).

const { pool } = require('../config/db');

/**
 * Pulls the next value from the url_mapping BIGSERIAL sequence WITHOUT
 * inserting a row. This is the first step of the approved short-code
 * flow: get the numeric ID before we know the short_code, so short_code
 * can be computed and inserted in the same statement (short_code is
 * NOT NULL — there is no "insert then update" step).
 */
async function getNextId() {
  const result = await pool.query("SELECT nextval('url_mapping_id_seq') AS id");
  return result.rows[0].id; // returned as a string (BIGINT), by design — see base62.js
}

/**
 * Inserts a fully-formed url_mapping row: the id and short_code are both
 * already known (computed by the service before calling this), so this
 * is a single INSERT with no follow-up UPDATE required.
 */
async function insertUrlMapping({ id, userId, shortCode, longUrl }) {
  const result = await pool.query(
    `INSERT INTO url_mapping (id, user_id, short_code, long_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id, short_code, long_url, created_at`,
    [id, userId, shortCode, longUrl]
  );
  return result.rows[0];
}

/**
 * Looks up the original long_url for a given short_code. Returns
 * undefined if no matching row exists — the service/controller decide
 * what to do with that (404).
 */
async function findByShortCode(shortCode) {
  const result = await pool.query(
    `SELECT id, long_url, user_id, created_at
     FROM url_mapping
     WHERE short_code = $1`,
    [shortCode]
  );
  return result.rows[0];
}

/**
 * Lists one user's URLs, newest first, with click totals. LEFT JOIN
 * because a url_stats row only exists once a URL has been clicked (the
 * worker creates it in Stage 7); COALESCE makes unclicked URLs show 0.
 * Served by idx_url_mapping_user_id.
 */
async function findAllByUserId(userId) {
  const result = await pool.query(
    `SELECT m.id, m.short_code, m.long_url, m.created_at,
            COALESCE(s.total_clicks, 0) AS total_clicks
     FROM url_mapping m
     LEFT JOIN url_stats s ON s.url_mapping_id = m.id
     WHERE m.user_id = $1
     ORDER BY m.created_at DESC, m.id DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Deletes a URL only if it belongs to the given user. Ownership is part
 * of the WHERE clause, so a user can never delete someone else's row,
 * and the check can't race with the delete. Returns the deleted row
 * (we need short_code to evict the cache) or undefined if nothing matched.
 */
async function deleteByIdAndUserId(id, userId) {
  const result = await pool.query(
    `DELETE FROM url_mapping
     WHERE id = $1 AND user_id = $2
     RETURNING id, short_code`,
    [id, userId]
  );
  return result.rows[0];
}

module.exports = {
  getNextId,
  insertUrlMapping,
  findByShortCode,
  findAllByUserId,
  deleteByIdAndUserId,
};
