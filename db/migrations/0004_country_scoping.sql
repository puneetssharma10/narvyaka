-- One-time migration. Run exactly once per environment:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0004_country_scoping.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0004_country_scoping.sql
--
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so unlike
-- db/schema.sql this file is NOT safe to run twice — running it again fails
-- with "duplicate column name", loudly, which is the point: it tells you it
-- already happened rather than silently corrupting anything.
--
-- Two plain ADD COLUMNs, no CHECK constraint touched — no table rebuild
-- needed. Every existing row gets NULL/0, which is exactly right: an
-- existing admin isn't scoped to any country until you assign one (see the
-- admin-account UI), and an existing record has no country until someone
-- edits it — both of which the read/write code treats as "visible to every
-- admin", not "hidden from all of them".

ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE submissions ADD COLUMN contributor_country TEXT;

CREATE INDEX IF NOT EXISTS idx_submissions_country ON submissions (contributor_country);
