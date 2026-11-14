-- 003_create_url_mapping_table.sql
--
-- Core table: maps a short_code to the original long_url, owned by a user.
--
-- user_id is NOT NULL here. Per the approved API design, POST /api/urls is
-- an authenticated-only endpoint (no anonymous creation path was defined),
-- so every row is expected to have an owner. If anonymous URL creation is
-- ever added later, this column can be relaxed with a follow-up migration
-- (ALTER TABLE ... ALTER COLUMN user_id DROP NOT NULL) rather than baking
-- in nullability now for a feature that isn't being built.
--
-- short_code is NOT NULL and UNIQUE, and is generated BEFORE the INSERT
-- (see note below on the id/short_code relationship) — never generated
-- from a row that was inserted with a placeholder value.

CREATE TABLE IF NOT EXISTS url_mapping (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_code      VARCHAR(10) UNIQUE NOT NULL,
    long_url        TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- short_code UNIQUE already creates an implicit unique index — this is the
-- hot lookup path for every redirect (GET /:code), so it's covered without
-- a separate CREATE INDEX statement.

-- user_id needs its own index: it's not covered by any UNIQUE/PK constraint,
-- but is queried constantly for "GET /api/urls" (list my URLs).
CREATE INDEX IF NOT EXISTS idx_url_mapping_user_id ON url_mapping (user_id);

-- NOTE on BIGSERIAL + Base62 short codes:
-- BIGSERIAL on `id` creates an underlying sequence (url_mapping_id_seq)
-- whose DEFAULT is nextval('url_mapping_id_seq'). Later application code
-- will call nextval() on this sequence explicitly BEFORE building the
-- INSERT statement, Base62-encode the returned number into short_code,
-- and then INSERT the row supplying both id and short_code directly
-- (rather than letting id default and short_code be null). This satisfies
-- short_code's NOT NULL constraint at insert time and requires no random
-- short-code generation or collision-retry logic — see the Stage 2
-- explanation for the full flow.
