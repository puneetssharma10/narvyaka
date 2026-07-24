# Narvyaka

**Because No Generation Should Start From Zero.**

Narvyaka preserves first-hand human experience — in the person's own voice — so
the next generation does not have to start from nothing.

This repository is the Phase 1 website: nine public pages, the intake flow, the
public archive, a visual editor, and the Cloudflare backend that receives
records.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321 — pages, styling, the Studio
npm run pages:dev    # http://localhost:8788 — everything, including the API
```

Before your first `pages:dev`, create the local database tables:

```bash
npm run db:local
```

---

## The one file you need to edit

**`site.config.ts`** — domain, contact email, social links. All blank on
purpose. Anything left empty is hidden from the site automatically: no dead
links, no empty `mailto:`, no wrong canonical URLs. Fill them in when they
exist; nothing else has to change.

---

## Layout

```
site.config.ts            ← domain / email / social. The top entry.
wrangler.toml             ← D1 + R2 bindings for Cloudflare

src/
  data/site.json          ← every editable string, colour, font and image
  styles/global.css       ← design tokens (§2 of the brief) + primitives
  layouts/Base.astro
  components/
    forms/                ← the intake form and the volunteer form (React islands)
    *.astro               ← header, footer, capsule card, audio player, icons
  lib/
    studio/               ← the visual editor, loaded only when it is opened
    cropper.ts            ← pan/zoom/rotate image cropper
    capsules.ts           ← reads the published archive at build time
  pages/                  ← one file per route

shared/
  record-schema.ts        ← the Wisdom Record schema + validation
  overrides.ts            ← the Studio's edit format
                            (both shared verbatim by browser and server)

functions/                ← Cloudflare Pages Functions — the whole API
  api/{submissions,uploads,volunteers,studio,health}.ts
  media/[[path]].ts

content/capsules/*.json   ← the published archive. One file per record.
db/schema.sql             ← D1 schema
scripts/apply-overrides.mjs ← turns a Studio export into a code change
```

---

## Pages

| Route | What it is |
| --- | --- |
| `/` | Homepage — hero, the problem, three ways in, the four parts |
| `/preserve` | The intake flow: consent → about you → the record → family note → photos → access & review |
| `/record-someone` | The same flow, for a volunteer filling it in on someone's behalf |
| `/volunteer` | Founding volunteer roles and application |
| `/about` | Mission and the name, then — after a clear break — the deeper meaning |
| `/how-it-works` | The Wisdom Record explained, with a sample |
| `/browse` | The public archive. Empty by design at launch. |
| `/capsule/[id]` | One published record |
| `/founder` | Letter from the founder |
| `/privacy`, `/terms` | Placeholders pending legal review |
| `/studio` | The visual editor (noindex) |

---

## The Studio

A visual editor built into the site. Open it at `/studio`, or press
<kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> on any page.

- **Text** — click any text on any page and type over it
- **Colour** — all ten design tokens, live
- **Type** — swap the wordmark, heading and body faces
- **Logo** — drag a PNG/SVG/WebP onto the drop zone, or straight onto the
  wordmark in the header
- **Photographs** — click any picture to replace it; a cropper opens first,
  with aspect presets, zoom and rotate

Changes preview instantly and are stored **in your browser only** until you do
one of two things:

```bash
# 1. The durable path — makes it a real, reviewable code change
npm run studio:apply ~/Downloads/narvyaka-overrides.json
git diff && npm run build

# 2. The quick path — publish to the live site with no rebuild
#    (needs a STUDIO_TOKEN; see INTEGRATIONS.md §4)
```

Server-published edits can be pulled back into the code so the two never drift:

```bash
npm run studio:pull -- https://your-site.pages.dev
npm run studio:apply studio-exports/published-overrides.json
```

The editor is lazily loaded — an ordinary visitor downloads **none** of it.

---

## The logo

There is no logo file. The header renders a text wordmark set in **Fraunces
italic**. The slot is built so a real logomark drops in later without any
component changing — via the Studio, or by setting `theme.logo.src` in
`src/data/site.json`. `public/favicon.svg` is a matching typographic
placeholder.

---

## Rules the code enforces

Pulled from the brief's locked decisions, with where each one lives:

| Rule | Enforced in |
| --- | --- |
| Nothing submitted goes live automatically — status starts `pending_review` | `functions/api/submissions.ts`, `db/schema.sql` |
| Verification status has exactly three values, no "unverified" default | `shared/record-schema.ts`, `db/schema.sql`, `VerificationBadge.astro` |
| The age-30 gate routes to review, it never blocks | `shared/record-schema.ts`, `IntakeForm.tsx` |
| No copy implies AI writes or interprets a story — transcription and translation only | `src/data/site.json` (`forms.consent`, `howItWorks.parts`) |
| The Family & Learning Note is part of a record, not a feature — no nav item, no branding | `IntakeForm.tsx`, `capsule/[id].astro` |
| `/about` keeps its two stages separate | `pages/about.astro` |
| Non-public records cannot render even if the file is present | `shared/record-schema.ts` (`toPublicRecord`) |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server, no API |
| `npm run pages:dev` | Full stack with local D1 and R2 |
| `npm run build` | Static build to `dist/` |
| `npm run check` | Type check across the site |
| `npm run db:local` / `db:remote` | Apply the database schema |
| `npm run studio:apply <file>` | Turn a Studio export into a code change |
| `npm run studio:pull -- <origin>` | Fetch server-published edits back |
| `npm run pages:deploy` | Build and deploy to Cloudflare Pages |

---

## Further reading

- **DEPLOYMENT.md** — deploying, and exactly what changes the day the domain is bought
- **INTEGRATIONS.md** — D1 and R2 setup, and where a record actually goes
- **CONTENT_STATUS.md** — what is real copy, what is placeholder, what still needs a decision
- **SECURITY.md** — what is defended, and what is knowingly not

---

## Stack

Astro 5 (static) · Tailwind CSS 4 · React 19 islands, only where there is
interaction · Cloudflare Pages, D1, R2 · self-hosted fonts, no CDN, no
analytics, no trackers.
