-- 001_create_schema_migrations_table.sql
--
-- Tracks which migration files have already been applied, so the migration
-- runner can be executed repeatedly (e.g. every time the container starts)
-- without re-running or re-creating tables that already exist.
--
-- This is intentionally the simplest possible tracking mechanism: one row
-- per applied migration filename. No rollback/"down" migrations, no
-- versioning framework — just enough to make "run migrations" idempotent.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    VARCHAR(255) PRIMARY KEY,
    applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
