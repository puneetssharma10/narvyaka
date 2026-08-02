-- Narvyaka — Cloudflare D1 schema
--
-- Apply locally:   npm run db:local
-- Apply to remote: npm run db:remote
--
-- Safe to re-run: every statement is IF NOT EXISTS.
--
-- This is the *index*, not the archive. The authoritative copy of every
-- submission is the JSON object in R2 (Master Reference Part XI: the original
-- evidence is never edited in place). If this database were lost entirely, the
-- archive could be rebuilt from the bucket.

-- ── Wisdom Records ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submissions (
  id                      TEXT PRIMARY KEY,
  -- LOCKED: nothing is inserted as anything other than 'pending_review'.
  -- Later values ('approved', 'published', 'withdrawn') are set by a person.
  status                  TEXT NOT NULL DEFAULT 'pending_review',
  submitted_at            TEXT NOT NULL,
  source                  TEXT NOT NULL DEFAULT 'self',      -- self | on_behalf
  object_key              TEXT NOT NULL,                     -- the R2 key of the full record

  contributor_name        TEXT,
  display_as_anonymous    INTEGER NOT NULL DEFAULT 0,
  contributor_location    TEXT,
  -- One of shared/countries.ts's COUNTRIES, or '' if not given. What an
  -- admin's country-scoped access (users.country) actually filters by —
  -- contributor_location is free text and not reliable enough for that.
  contributor_country     TEXT,
  contributor_profession  TEXT,
  record_language         TEXT,
  contact                 TEXT,                              -- never published

  age_confirmed_30_plus   INTEGER NOT NULL DEFAULT 0,
  exception_reason        TEXT,                              -- under-30 route to review

  key_lesson              TEXT,
  access_level            TEXT NOT NULL DEFAULT 'preserved_not_published',
  release_date            TEXT,

  -- Exactly three values (Master Reference Part VII.1). A reviewer may change
  -- it; nothing may add a fourth.
  verification_status     TEXT NOT NULL DEFAULT 'Contributor''s Account',

  has_audio               INTEGER NOT NULL DEFAULT 0,
  photo_count             INTEGER NOT NULL DEFAULT 0,
  payload_json            TEXT NOT NULL,

  reviewed_by             TEXT,
  reviewed_at             TEXT,
  review_notes            TEXT,

  client_ip               TEXT,                              -- abuse review only

  CHECK (status IN ('pending_review', 'approved', 'published', 'withdrawn')),
  CHECK (verification_status IN ('Documented', 'Contributor''s Account', 'Family Tradition')),
  CHECK (access_level IN (
    'public', 'public_anonymous', 'family_only', 'restricted_research',
    'private', 'preserved_not_published', 'publish_after_date', 'release_after_death'
  ))
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_access ON submissions (access_level);
CREATE INDEX IF NOT EXISTS idx_submissions_country ON submissions (contributor_country);
CREATE INDEX IF NOT EXISTS idx_submissions_exception ON submissions (age_confirmed_30_plus, status);

-- ── Founding volunteers ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS volunteers (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'pending_review',
  submitted_at    TEXT NOT NULL,
  name            TEXT NOT NULL,
  contact         TEXT NOT NULL,
  location        TEXT,
  roles           TEXT NOT NULL,                             -- JSON array
  languages       TEXT,                                      -- JSON array
  why             TEXT,
  approach        TEXT NOT NULL,                             -- Part IX.3
  time_commitment TEXT,
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  review_notes    TEXT,
  client_ip       TEXT,

  CHECK (status IN ('pending_review', 'accepted', 'declined'))
);

CREATE INDEX IF NOT EXISTS idx_volunteers_status ON volunteers (status, submitted_at DESC);

-- ── Uploaded media ─────────────────────────────────────────────────────────
-- An index of what is in the bucket, so a withdrawn record can be cleaned up
-- completely without listing the whole of R2.
CREATE TABLE IF NOT EXISTS uploads (
  key          TEXT PRIMARY KEY,
  record_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,                                -- audio | photo
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,

  -- Which bucket actually holds this object. 'primary' is the bucket bound as
  -- env.MEDIA; any other value is a node id from the STORAGE_NODES secret,
  -- possibly a bucket in an account this deployment does not own. Rows written
  -- before storage nodes existed have NULL here and are read as 'primary'.
  storage_node TEXT NOT NULL DEFAULT 'primary',

  CHECK (kind IN ('audio', 'photo'))
);

CREATE INDEX IF NOT EXISTS idx_uploads_record ON uploads (record_id);

-- ── Rate limiting ──────────────────────────────────────────────────────────
-- Fixed-window counters. Cloudflare's own rate limiting rules are the real
-- defence; this stops one careless script, not a determined attacker.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- ── Accounts ───────────────────────────────────────────────────────────────
-- Four tiers. Only three ever get a row here — a reader is just a visitor,
-- nothing to store.
--
--   super_admin   You. Full access — every record, every account, the
--                 Studio. Not country-scoped.
--   admin         Read/write access to records, but only the ones whose
--                 contributor_country matches this account's own country
--                 (or whose country isn't set at all — an old/unassigned
--                 record isn't hidden from everyone just because no one's
--                 filled that field in yet). Approves/revokes volunteer
--                 accounts. Cannot touch the Studio and cannot create
--                 another admin — that boundary is deliberate, see
--                 CONTENT_STATUS.md.
--   volunteer     Can create records and edit only the records they own
--                 (submissions.owner_user_id = their own id). Nothing else.
--
-- Passwords are salted PBKDF2-SHA256, hashed in the Worker with WebCrypto —
-- never anything reversible, never plaintext, never logged.
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,          -- "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,  -- set on admin-issued temp passwords
  -- Only ever meaningful for role = 'admin' — one of shared/countries.ts's
  -- COUNTRIES, set by the super_admin when the account is created (see
  -- functions/api/admin/users.ts). NULL for super_admin/volunteer, who
  -- aren't country-scoped at all.
  country         TEXT,
  -- Only ever meaningful for role = 'volunteer'. Granted/revoked by the
  -- super_admin alone (functions/api/admin/users/[id].ts) — an admin can
  -- revoke a volunteer's whole account but not this specifically.
  can_download    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT,                   -- user id that approved/created this account
  last_login_at   TEXT,

  CHECK (role IN ('super_admin', 'admin', 'volunteer')),
  CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role, status);

-- Server-side sessions, so revoking access is immediate — no waiting for a
-- JWT to expire. The cookie holds a random token; only its hash lives here,
-- the same reasoning as the password itself: a database read must not be
-- enough to impersonate someone.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- The `owner_user_id` / `user_id` ownership columns on submissions/volunteers
-- are NOT here — SQLite has no "ADD COLUMN IF NOT EXISTS", so an ALTER TABLE
-- cannot safely live in a file that is re-run on every deploy. That one-time
-- change lives in db/migrations/0001_accounts.sql — run once, per environment,
-- per INTEGRATIONS.md § Accounts.
