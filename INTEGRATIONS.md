# Integrations — database and object storage

Both are **required** before the site can accept a single record. Until they
exist, `/preserve` renders and saves drafts, but submitting returns an honest
"not connected yet" message instead of pretending to succeed.

Everything below is on Cloudflare's free tier at this scale.

---

## 0. One-time: log in

```bash
npx wrangler login
```

Opens a browser. If you are on a machine without one, use
`npx wrangler login --browser=false` and paste the URL.

---

## 1. Database — Cloudflare D1

**What it holds:** one row per submission and per volunteer application — the
index that makes records findable, reviewable and countable.

**Dashboard:** https://dash.cloudflare.com/ → Workers & Pages → D1 SQL Database
**Docs:** https://developers.cloudflare.com/d1/

```bash
# Create it
npx wrangler d1 create narvyaka

# Create the preview one too, so branch deploys never touch real records
npx wrangler d1 create narvyaka-preview
```

Each command prints a `database_id`. Paste them into **`wrangler.toml`**,
replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID` and
`REPLACE_WITH_YOUR_PREVIEW_D1_DATABASE_ID`. These IDs are not secrets and
belong in the repository.

Then create the tables:

```bash
npm run db:local     # for local development
npm run db:remote    # for the live database
```

Re-running either is safe — every statement is `IF NOT EXISTS`.

---

## 2. Object storage — Cloudflare R2

**What it holds:** audio recordings, photographs, the untouched JSON of every
submission, and any Studio edits published to the live site.

R2 is the authoritative store. If D1 were lost entirely, the archive could be
rebuilt from this bucket — which is the point (Master Reference Part XI).

**Dashboard:** https://dash.cloudflare.com/ → R2 Object Storage
**Docs:** https://developers.cloudflare.com/r2/

```bash
npx wrangler r2 bucket create narvyaka-media
npx wrangler r2 bucket create narvyaka-media-preview
```

The bucket names in `wrangler.toml` already match. Nothing else to change.

### Optional: a custom domain for media

By default, media is served through this site at `/media/*` — a Pages Function
reads the object from R2 and streams it. That works, and it is what runs until
you do anything else.

It costs an extra hop, so once you have a domain:

1. R2 → `narvyaka-media` → Settings → **Public access** → Connect a domain
2. Use something like `media.narvyaka.org`
3. Put that URL in `wrangler.toml` under `PUBLIC_MEDIA_BASE_URL`

New uploads then return the direct URL. Existing `/media/*` URLs keep working,
so this is safe to do at any time.

> **Do not** enable the `r2.dev` public development URL for a bucket holding
> contributor submissions. It is unauthenticated and rate-limited, and this
> bucket contains records at every access level, including private ones.

---

## 3. Bind them to the Pages project

If you deploy with `npm run pages:deploy` or Git integration, `wrangler.toml`
is read automatically and this is already done.

To check or set it by hand:

**Cloudflare dashboard → Workers & Pages → narvyaka → Settings → Functions → Bindings**

| Binding name | Type      | Value                  |
| ------------ | --------- | ---------------------- |
| `DB`         | D1        | `narvyaka`             |
| `MEDIA`      | R2 bucket | `narvyaka-media`       |

The names matter. The code looks for exactly `DB` and `MEDIA`.

---

## 4. Secrets

Only one, and only if you want the Studio to publish edits straight to the live
site:

```bash
npx wrangler pages secret put STUDIO_TOKEN
# paste a long random string — e.g. from: openssl rand -base64 32
```

For local development, copy `.dev.vars.example` to `.dev.vars` and put the same
value there. `.dev.vars` is gitignored.

Without it, the Studio still works fully — Export + `npm run studio:apply` needs
no token at all, and that is the path that produces a reviewable change.

---

## 5. Confirm it worked

```bash
curl https://your-site.pages.dev/api/health
```

```json
{
  "ok": true,
  "intake": "accepting submissions",
  "checks": {
    "database": { "ok": true, "detail": "D1 connected, schema present." },
    "storage":  { "ok": true, "detail": "R2 connected, served through /media/*" },
    "studio":   { "ok": true, "detail": "Studio can publish overrides to the live site." }
  }
}
```

The same information is shown at the bottom of `/studio`, in plain language.

`"ok": false` names the missing piece and how to add it. Do not announce the
site until this returns `true`.

---

## Where a record actually goes

```
Contributor fills in /preserve
        │
        ├─ photographs + recordings ──▶ POST /api/uploads
        │                                └─▶ R2  uploads/<record-id>/<uuid>.<ext>
        │
        └─ the answers ───────────────▶ POST /api/submissions
                                         ├─▶ R2  submissions/<record-id>.json   ← the evidence
                                         └─▶ D1  submissions row                 ← the index
                                                 status = pending_review

A person reviews it, confirms it with the contributor, sets the verification
status, and copies the approved record into content/capsules/<id>.json.

        └─▶ rebuild ─▶ /browse and /capsule/<id>
```

There is **no** code path from a form submission to a published page. That is
deliberate and locked (Build Brief §9).

---

## Retrieving submissions for review

Until the Phase 3 review tooling exists, use the CLI:

```bash
# Everything waiting
npx wrangler d1 execute narvyaka --remote \
  --command "SELECT id, submitted_at, contributor_name, substr(key_lesson,1,60) AS lesson, access_level FROM submissions WHERE status='pending_review' ORDER BY submitted_at"

# Under-30 submissions needing an exception decision (Part VIII.1)
npx wrangler d1 execute narvyaka --remote \
  --command "SELECT id, exception_reason FROM submissions WHERE age_confirmed_30_plus=0 AND status='pending_review'"

# The full record
npx wrangler r2 object get narvyaka-media/submissions/<record-id>.json --file ./record.json

# Volunteer applications
npx wrangler d1 execute narvyaka --remote \
  --command "SELECT submitted_at, name, contact, roles, approach FROM volunteers WHERE status='pending_review'"
```

### Honouring a withdrawal

```bash
# Find the files
npx wrangler d1 execute narvyaka --remote --command "SELECT key FROM uploads WHERE record_id='<record-id>'"

# Delete each one, then the submission itself
npx wrangler r2 object delete narvyaka-media/<key>
npx wrangler r2 object delete narvyaka-media/submissions/<record-id>.json
npx wrangler d1 execute narvyaka --remote --command "DELETE FROM uploads WHERE record_id='<record-id>'"
npx wrangler d1 execute narvyaka --remote --command "UPDATE submissions SET status='withdrawn', payload_json='{}' WHERE id='<record-id>'"
```

Also delete `content/capsules/<id>.json` and rebuild, if it had been published.

---

## Alternatives, if you ever move off Cloudflare

Nothing in the site code is Cloudflare-specific except the four files in
`functions/`. The schema (`shared/record-schema.ts`) and the SQL
(`db/schema.sql`) are plain and portable.

| Need     | Cloudflare (used) | Would also work                              |
| -------- | ----------------- | -------------------------------------------- |
| Database | D1 (SQLite)       | Turso, Neon, Supabase Postgres, plain SQLite |
| Storage  | R2                | Backblaze B2, S3, Wasabi                     |
| Functions| Pages Functions   | Netlify Functions, Vercel, a small VPS       |

The Master Reference puts Supabase and shared workflow tooling in Phase 3,
triggered only once 5+ volunteers need it. Do not bring it forward.
