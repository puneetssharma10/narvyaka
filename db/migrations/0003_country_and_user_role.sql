-- One-time migration. Run exactly once per environment:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0003_country_and_user_role.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0003_country_and_user_role.sql
--
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so unlike
-- db/schema.sql this file is NOT safe to run twice — running it again fails
-- (the users table won't exist under its old name any more, or the columns
-- will already be there), which is exactly the point: it tells you it
-- already happened rather than silently corrupting anything.
--
-- What this does:
--   1. Adds a `user` role — self-signup, read-only, no admin approval.
--   2. Adds `users.country` — the country an `admin` account is scoped to
--      (NULL = unscoped/global; only meaningful for role='admin', a
--      super_admin is always global regardless of this column).
--   3. Adds `submissions.country` — the normalized country a record's
--      country-scoped admin access is matched against, backfilled verbatim
--      from the existing free-text `contributor_location` (good enough for
--      phase 1 — no geocoding).
--
-- SQLite cannot ALTER a CHECK constraint, so widening users.role means
-- rebuilding the table: create users_new with the new shape, copy every
-- existing column across, drop the old table, rename the new one in.

ALTER TABLE submissions ADD COLUMN country TEXT;
UPDATE submissions SET country = contributor_location WHERE contributor_location IS NOT NULL;

CREATE TABLE users_new (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  last_login_at   TEXT,
  country         TEXT,

  CHECK (role IN ('super_admin', 'admin', 'volunteer', 'user')),
  CHECK (status IN ('active', 'revoked'))
);

INSERT INTO users_new (
  id, email, password_hash, role, status, must_change_password, created_at, created_by, last_login_at, country
)
SELECT
  id, email, password_hash, role, status, must_change_password, created_at, created_by, last_login_at, NULL
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role, status);
CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);
CREATE INDEX IF NOT EXISTS idx_submissions_country ON submissions (country);
