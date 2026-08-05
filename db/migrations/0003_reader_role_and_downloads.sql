-- One-time migration. Run exactly once per environment, AFTER 0001_accounts.sql
-- and 0002_storage_nodes.sql have both been applied:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0003_reader_role_and_downloads.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0003_reader_role_and_downloads.sql
--
-- Adds the `reader` role and the `can_download` flag to `users`. SQLite has
-- no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" and cannot widen a CHECK
-- constraint in place, so this rebuilds the table rather than altering it.
--
-- This also drops a leftover `country` column: an earlier, abandoned RBAC
-- experiment ran its own schema.sql against this database before being
-- backed out, and that column is the only trace of it left behind. It was
-- never read by any code on this branch.
--
-- Any row whose role isn't one this schema recognises (e.g. 'user', from
-- that same abandoned experiment) is mapped to 'reader' — the closest match,
-- since that experiment's 'user' role was also self-signup, view-only.

DELETE FROM sessions; -- users is being rebuilt; sessions.user_id FKs it, and D1
                       -- enforces FKs regardless of PRAGMA foreign_keys — every
                       -- signed-in account simply signs back in.

ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  can_download    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  last_login_at   TEXT,

  CHECK (role IN ('super_admin', 'admin', 'volunteer', 'reader')),
  CHECK (status IN ('active', 'revoked'))
);

INSERT INTO users (
  id, email, password_hash, role, status, must_change_password, can_download, created_at, created_by, last_login_at
)
SELECT
  id, email, password_hash,
  CASE WHEN role IN ('super_admin', 'admin', 'volunteer') THEN role ELSE 'reader' END,
  status, must_change_password, 0, created_at, created_by, last_login_at
FROM users_old;

DROP TABLE users_old;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role, status);
