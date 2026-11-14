-- 004_create_click_events_table.sql
--
-- Raw, append-only log of every click on a short URL. This is the source
-- of truth for analytics; url_stats (next migration) is a derived rollup
-- kept in sync from this table by the BullMQ worker (Stage 7).

CREATE TABLE IF NOT EXISTS click_events (
    id                  BIGSERIAL PRIMARY KEY,
    url_mapping_id      BIGINT NOT NULL REFERENCES url_mapping(id) ON DELETE CASCADE,
    clicked_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Needed for per-URL analytics queries (GET /api/urls/:id/analytics), e.g.
-- "all click events for url_mapping_id = X, ordered by time".
CREATE INDEX IF NOT EXISTS idx_click_events_url_mapping_id ON click_events (url_mapping_id);
