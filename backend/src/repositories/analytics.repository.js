// src/repositories/analytics.repository.js
//
// Raw SQL for click analytics: one WRITE used by the worker process, and
// the READS behind GET /api/urls/:id/analytics.

const { pool } = require('../config/db');

/**
 * Records one click: inserts a click_events row AND bumps url_stats, as a
 * single transaction, so the raw log and the rollup can never disagree.
 * Either both happen or neither does.
 *
 * Returns the url_mapping id that was updated, or null if the URL no
 * longer exists (deleted between the click and now). A deleted URL is not
 * an error worth retrying, so the caller just skips it.
 *
 * The counter update is ONE atomic statement:
 *     total_clicks = url_stats.total_clicks + 1
 * evaluated inside PostgreSQL under a row lock. Reading the value into
 * Node, adding 1 and writing it back would lose clicks when two worker
 * jobs touch the same URL at the same moment.
 *
 * Timestamps: the job carries the real click time. We cast it with
 * ::timestamptz so PostgreSQL converts it to the column's TIMESTAMP using
 * the session time zone, exactly like the NOW() default used by the other
 * tables, instead of silently dropping the zone from the ISO string.
 * last_clicked_at uses GREATEST so an older job finishing late (several
 * jobs run concurrently) can never move it backwards.
 */
async function recordClick(shortCode, clickedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query('SELECT id FROM url_mapping WHERE short_code = $1', [shortCode]);
    if (found.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const urlId = found.rows[0].id;

    await client.query(
      'INSERT INTO click_events (url_mapping_id, clicked_at) VALUES ($1, $2::timestamptz)',
      [urlId, clickedAt]
    );

    await client.query(
      `INSERT INTO url_stats (url_mapping_id, total_clicks, last_clicked_at)
       VALUES ($1, 1, $2::timestamptz)
       ON CONFLICT (url_mapping_id) DO UPDATE
       SET total_clicks = url_stats.total_clicks + 1,
           last_clicked_at = GREATEST(url_stats.last_clicked_at, EXCLUDED.last_clicked_at)`,
      [urlId, clickedAt]
    );

    await client.query('COMMIT');
    return urlId;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be broken; the original error matters more.
    }
    // 23503 = foreign_key_violation: the URL was deleted in the instant
    // between our lookup and the insert. Same outcome as "not found".
    if (err.code === '23503') return null;
    throw err; // unexpected (e.g. DB down): let BullMQ retry the job
  } finally {
    client.release();
  }
}

/**
 * Stats for ONE url, only if it belongs to the given user (ownership is in
 * the WHERE clause, as in delete). LEFT JOIN: a never-clicked URL has no
 * url_stats row yet, so COALESCE reports 0.
 */
async function findStatsForUser(urlId, userId) {
  const result = await pool.query(
    `SELECT m.id, m.short_code, m.long_url,
            COALESCE(s.total_clicks, 0) AS total_clicks,
            s.last_clicked_at
     FROM url_mapping m
     LEFT JOIN url_stats s ON s.url_mapping_id = m.id
     WHERE m.id = $1 AND m.user_id = $2`,
    [urlId, userId]
  );
  return result.rows[0];
}

/**
 * Most recent raw click events for a URL, newest first. Uses
 * idx_click_events_url_mapping_id to find this URL's rows.
 */
async function findRecentClicks(urlId, limit) {
  const result = await pool.query(
    `SELECT clicked_at
     FROM click_events
     WHERE url_mapping_id = $1
     ORDER BY clicked_at DESC, id DESC
     LIMIT $2`,
    [urlId, limit]
  );
  return result.rows;
}

module.exports = { recordClick, findStatsForUser, findRecentClicks };
