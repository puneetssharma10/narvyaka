-- One-time migration. Run exactly once per environment:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0001_accounts.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0001_accounts.sql
--
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so unlike
-- db/schema.sql this file is NOT safe to run twice — running it again fails
-- with "duplicate column name", loudly, which is the point: it tells you it
-- already happened rather than silently corrupting anything.

ALTER TABLE submissions ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE volunteers  ADD COLUMN user_id       TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_submissions_owner ON submissions (owner_user_id);
