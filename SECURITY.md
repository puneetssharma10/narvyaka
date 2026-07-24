# Security

This site collects people's life stories, some of them at access levels the
contributor expects to stay private. What follows is what is actually defended,
and — more usefully — what is knowingly not.

## Reporting something

Until a contact address is published in `site.config.ts`, report anything you
find through the volunteer page. Please do not open a public issue for a
vulnerability that exposes contributor data.

---

## What is defended

**Nothing publishes itself.** `functions/api/submissions.ts` writes
`status: 'pending_review'` unconditionally. A client-supplied `status` is
discarded before the row is written, and `db/schema.sql` has a `CHECK`
constraint behind that. This is verified by an end-to-end test that submits
`{"status": "published"}` and asserts it comes back as `pending_review`.

**Private records are not web-reachable.** The R2 bucket holds submissions at
every access level. `functions/media/[[path]].ts` serves only the prefixes
`uploads/`, `capsules/` and `site/` — `submissions/` and `volunteers/` return
404 regardless of whether the key exists. At build time, `toPublicRecord()`
returns `null` for anything that is not both `published` and publicly
accessible, so a non-public record placed in `content/capsules/` renders as
nothing rather than as a leak.

**Uploads are allowlisted, not sniffed.** `functions/api/uploads.ts` accepts
only the declared MIME types in `ALLOWED_UPLOAD_TYPES`, refuses a mismatch
between the declared kind and the type, caps size at 10 MB, and writes under a
server-generated UUID — a client cannot choose the storage path. The record ID
is checked against a UUID pattern before it becomes part of a key.

**Studio edits are re-validated server-side.** A token holder still cannot
inject CSS or a `javascript:` URL: `parseOverrides()` runs again in
`functions/api/studio.ts` and strips any value containing `;{}<>\`, `url(`,
`@import`, or an image `src` that is not a same-origin path, an `https:` URL, or
a base64 image data URI. Verified by a test that publishes a CSS breakout and a
`javascript:` image and asserts both are dropped.

**The Studio token is compared in constant time** (`safeEqual`), and publishing
is refused outright when no token is configured rather than defaulting to open.

**SVG logos are allowed, deliberately and narrowly.** A logomark should stay
vector. SVG is only ever rendered through `<img src>`, which is a passive
context — scripts and external references inside the file do not execute there.
The Studio additionally refuses any SVG containing `<script`, `javascript:` or
`onload=` before it can be stored.

**Rate limiting** is a fixed-window counter in D1: 8 submissions, 60 uploads and
5 volunteer applications per IP per hour. If the limiter itself errors it fails
*open*, because a broken limiter must not block a genuine contributor.

**Request bodies are capped** before parsing (1 MB of JSON for a record, 256 KB
for an application, 4 MB for Studio overrides).

**No third parties.** No analytics, no advertising pixel, no font CDN, no
external script of any kind. Fonts are bundled and served from the same origin.
Nothing about a visitor leaves this site.

**Contributor contact details are never published.** `contact` is stored on the
row and stripped by `toPublicRecord()` — it cannot reach a rendered page.

---

## What is knowingly not defended

**The D1 rate limiter is not distributed-attack-proof.** It is one row per
window; a botnet with many IPs goes around it. Cloudflare's own WAF and rate
limiting rules are the real defence and should be switched on before the site is
publicised.

**`Content-Security-Policy` allows `'unsafe-inline'` for scripts and styles.**
This is a real weakening and it is a deliberate trade. The theme boot script in
`StudioBoot.astro` must run before first paint or an edited site flashes its
default colours on every load, and Astro emits inline styles for per-component
scoping. Everything else in the policy is tight: `default-src 'self'`,
`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, and no
external origin is permitted for scripts. The exposure is a stored-XSS payload
finding a rendered sink — and no user-submitted content is rendered as HTML
anywhere on the site. If that ever changes, move the boot script to a
nonce or a hash and remove `'unsafe-inline'`.

**Astro 5.18.2 carries GHSA-j687-52p2-xcff** — XSS in `define:vars` via
incomplete `</script>` sanitisation, fixed in Astro 6.1.6. This build does not
use `define:vars` anywhere (checked; the boot script writes its constants
literally for exactly this reason), so it is not reachable. Revisit when
upgrading past Astro 5, and do not introduce `define:vars` with untrusted data
in the meantime.

**There is no authentication anywhere**, because there are no accounts. The
Studio is protected by nothing on the client — anyone can open it and change
what *their own browser* shows. That is harmless: it is localStorage. Only
`POST /api/studio` changes what other people see, and that needs the token.

**A contributor cannot withdraw a record themselves.** Withdrawal is a manual
process (INTEGRATIONS.md → *Honouring a withdrawal*). Given the promise made on
`/privacy`, someone must actually be reading the inbox for that promise to hold.

**Client IPs are stored** on submissions and applications, for abuse review
only. They are never published. They should be purged on a schedule once a
retention period is decided — that decision has not been made yet.

**Nothing is encrypted at rest beyond what Cloudflare provides.** For records at
`private` or `release_after_death`, that may not be enough. Worth revisiting
before promising anything stronger than what `/privacy` currently says.

---

## Before going live

- [ ] Turn on Cloudflare WAF and rate limiting rules for the zone
- [ ] Set `STUDIO_TOKEN` to a long random value, or leave publishing off entirely
- [ ] Confirm the R2 bucket's `r2.dev` public URL is **disabled**
- [ ] Confirm `/media/submissions/<anything>` returns 404 on the live site
- [ ] Confirm `/api/health` returns `"ok": true`
- [ ] Have the privacy policy and terms reviewed (Part XV), and set
      `isPlaceholder: false` only once that has actually happened
