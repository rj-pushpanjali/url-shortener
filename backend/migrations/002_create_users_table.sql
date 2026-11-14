-- 002_create_users_table.sql
--
-- Registered users. Passwords are never stored in plain text — only a
-- bcrypt hash (added in Stage 5, but the column exists now so we don't
-- have to alter the table later).

CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- email UNIQUE already creates an implicit unique index, which also serves
-- as the lookup index for login (WHERE email = $1). No separate index needed.
