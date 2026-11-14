-- 005_create_url_stats_table.sql
--
-- Denormalized one-row-per-URL rollup, so the dashboard's "total clicks"
-- column is an O(1) primary-key lookup instead of a COUNT(*) over
-- click_events on every page load. Kept up to date by the BullMQ worker
-- via an upsert (INSERT ... ON CONFLICT (url_mapping_id) DO UPDATE ...)
-- each time a click_events row is written — implemented in Stage 7.

CREATE TABLE IF NOT EXISTS url_stats (
    url_mapping_id      BIGINT PRIMARY KEY REFERENCES url_mapping(id) ON DELETE CASCADE,
    total_clicks        BIGINT NOT NULL DEFAULT 0,
    last_clicked_at      TIMESTAMP
);

-- No additional index needed: url_mapping_id is already the primary key
-- (and therefore indexed), and it's the only column this table is ever
-- looked up by (join/lookup from url_mapping.id).
