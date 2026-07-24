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
