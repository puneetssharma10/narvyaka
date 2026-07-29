-- One-time migration. Run exactly once per environment:
--
--   npx wrangler d1 execute narvyaka --remote --file=./db/migrations/0002_storage_nodes.sql
--   npx wrangler d1 execute narvyaka --local  --file=./db/migrations/0002_storage_nodes.sql
--
-- SQLite has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", so unlike
-- db/schema.sql this file is NOT safe to run twice — running it again fails
-- with "duplicate column name", loudly, which is the point: it tells you it
-- already happened rather than silently corrupting anything.
--
-- Records which bucket actually holds each object. 'primary' is the bucket
-- bound as env.MEDIA; any other value is a node id from the STORAGE_NODES
-- secret, which may be a bucket in an account this deployment does not own.
-- Every row that already exists predates storage nodes and is therefore on
-- the primary bucket, which is exactly what the default backfills.

ALTER TABLE uploads ADD COLUMN storage_node TEXT NOT NULL DEFAULT 'primary';
