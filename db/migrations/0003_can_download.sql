-- One-time migration. Run exactly once per environment:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0003_can_download.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0003_can_download.sql
--
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so unlike
-- db/schema.sql this file is NOT safe to run twice — running it again fails
-- with "duplicate column name", loudly, which is the point: it tells you it
-- already happened rather than silently corrupting anything.
--
-- A plain ADD COLUMN, unlike the role/status CHECK constraints elsewhere in
-- this schema — no table rebuild needed, no existing row affected beyond
-- getting the default (0, not downloadable) it would already have.

ALTER TABLE users ADD COLUMN can_download INTEGER NOT NULL DEFAULT 0;
