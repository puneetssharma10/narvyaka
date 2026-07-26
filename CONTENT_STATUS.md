# Content status — what is real and what is not

Source of truth: **NARVYAKA — Founding Vision v1.1** (Puneet Sharma, 24 July
2026). Its own rule applies here: *"If website copy ever drifts from this
document, this document wins — unless a change is explicitly agreed and
recorded by the founding team."*

Every visible string lives in `src/data/site.json`. This file records where each
piece came from.

---

## ✅ From the Founding Vision — do not reword without a decision

| Where | Source section |
| --- | --- |
| `home.hero.tagline` / `.subhead` | Appendix A — the tagline system |
| `home.hero.intro`, `home.problem.*` | *Why Narvyaka Exists* — the manual passage |
| `home.status.body` | *How Narvyaka Will Grow* — "begins deliberately small" |
| `about.stage1.mission` | *The Mission* |
| `about.stage1.vision` | *A Letter from the Founder* |
| `about.stage1.belief` | *Our Belief* — "Every expert deserves a successor" |
| `about.stage1.name` / `.nameBody` | *The Meaning of Narvyaka* |
| `about.stage2.figures.*` | *The Meaning of Narvyaka* — Vyasa/Narada/Kakabhushundi |
| `preserve.test.*` | *The Narvyaka Test* — the five questions |
| `howItWorks.parts.*` | *The Wisdom Record* — the four parts |
| `howItWorks.audioBody.*` | *Why We Begin With Audio* |
| `howItWorks.storage*` | *How Narvyaka Will Grow* — deliberate redundancy |
| `howItWorks.reviewBody` | *Dignity, Consent, and Truth* |
| `howItWorks.rules` / `.ruleClosing` | *Our Rule for Building* |
| `recordSomeone.*` | *Begin with someone you know* |
| `volunteer.*`, `volunteer.pledge.*` | *This Is Not Someone Else\'s Job*, *The Narvyaka Pledge* |
| `founder.letter.*` | *A Letter from the Founder*, in full |
| `forms.consent.ageWhy` / `.exception*` | *Who Can Contribute* |
| `footer.philosophy` / `.blurb` | Closing page |

### A correction worth recording

An earlier build had the three figures in the wrong order **and** mapped to the
wrong responsibilities. The Founding Vision is explicit:

- **Vyasa — Preserve**
- **Narada — Connect**
- **Kakabhushundi — Continue**

That is now what `/about` renders, in that order.

---

## ⚠️ Still placeholder — clearly labelled in the UI

### `/privacy` and `/terms`
Marked *pending legal review* and set to `noindex`. The commitments described
are drawn from *Dignity, Consent, and Truth* and are accurate to how the system
is actually built. Set `isPlaceholder: false` and fill in `lastUpdated` after
review.

### Homepage hero capsule
Labelled **Example**, with the note "It is not a real contributor\'s record."
Replace with the first real recording: set `home.exampleCapsule.audioSrc`,
`.photo`, `.lesson`, `.attribution`, and change `.badge`.

### `content/capsules/example.json`
Not a real contributor. Excluded from `/browse`, labelled "Example" on its own
page. **Delete it once a real record is published.**

### Placeholder imagery
`public/placeholder-capsule.svg` and `public/placeholder-portrait.svg` are
drawn, not photographed — deliberately, so no stock photo of strangers is ever
implied to be a contributor. Replace via Studio → click the picture.

**`/founder` is no longer a placeholder.** It carries the real letter.

---

## 🔧 Still invented — needs the Master Reference

### `categories` in `src/data/site.json`
The Primary Category list lives in the Master Reference (the build document),
not the Founding Vision, and was not available. The fifteen categories there are
a **working guess**.

Low-risk today — `/browse` hides the filter below 15 records, and no form asks a
contributor to choose one — but replace them before classifying anything.

### `experienceTypes`
Same situation: Method / Mistake / Decision / Skill / Memory / Lesson.

---

## 🎨 Design decisions taken against the original brief

**Palette.** The brief specified warm terracotta on cream. That was explicitly
overridden: no brown or beige, bold colours in the register of a high-end car
finish. The system is cool platinum pages, electric cobalt, Rosso as a signal,
Verde and Giallo for status. Carbon (`#0B0E14`) remains a token and is used for
text and the logomark, but no longer as a full-bleed surface — the homepage and
footer are light throughout.

**Type.** The brief asked for a humanist serif (Source Serif 4 / Lora) and
Fraunces italic for the wordmark. Both were dropped in favour of Space Grotesk
(wordmark) and Sora (headings) to match the "looks of the future" direction; a
literary serif inside this palette read as two different brands. Fraunces, Lora
and Source Serif are no longer installed — reinstate with
`npm i @fontsource-variable/fraunces` and set `theme.fonts.wordmark`.

**Everything else follows the brief**: 720px reading measure, 1200px grid,
96px/56px section rhythm, 12px cards and 8px controls, fade-in-on-scroll only,
drawn imagery rather than stock.

**Logo.** The brief said to build a text wordmark because no logo existed. One
now does: `src/components/LogoMark.astro` — a geometric N whose two stems are
the person who knew and the person who needs to know, with the single rising
diagonal between them carrying the cobalt-to-Rosso gradient. Also at
`public/logo.svg` and in the favicon. A supplied logo file dropped in via the
Studio still replaces it entirely, with no component changes.

**Scope.** Ten records, two volunteers — stated on the homepage and enforced on
`/volunteer`, which advertises exactly two openings and offers only those two in
the form.

---

## Two things that must not drift

**Verification status has exactly three values.** Enforced in
`shared/record-schema.ts`, the `CHECK` constraint in `db/schema.sql`, and
`VerificationBadge.astro`. No "unverified" default.

**Nothing publishes itself.** Every submission is written as `pending_review`
and the intake API has no path that sets anything else. An admin or the
super_admin *can* move a record through `approved` → `published` →
`withdrawn` from `/admin` (`functions/api/submissions/[id].ts`) — but that
only updates the D1 status. `/browse` and `/capsule/<id>` still read from
`content/capsules/*.json` at build time, so an in-app "publish" is the review
decision, not the last step; see INTEGRATIONS.md §6.4 for the manual copy
that's still required until those pages read from D1 directly.

---

## Accounts — why admins can't touch the Studio or create other admins

`functions/_shared/auth.ts` draws a boundary that's worth stating plainly,
since nothing in the code itself explains a *decision* — only what it does:

An admin can review and edit any Wisdom Record and approve or revoke a
volunteer's account. They cannot publish anything through the Studio, and
they cannot create another admin account. Both of those stay with the
super_admin alone. The reasoning: the Studio changes what every visitor sees
on the homepage, the founder's letter, the palette — the site's voice, not
one contributor's record — and deciding who else gets that same reach is the
same kind of decision. Reviewing records and vetting volunteers is real,
substantial trust; it is still a different, narrower kind of trust than
being able to rewrite the site itself or hand that power to someone else.

If this ever needs to change — say, a second person who should also be able
to publish Studio edits — that's a one-line change in `auth.ts`'s
`requireRole` calls (`functions/api/studio.ts` and `functions/api/admin/users.ts`),
not a redesign. It was left narrow on purpose, not by oversight.

---

## Where to edit

- **Small wording changes:** `/studio` → turn editing on → click the text →
  Export → `npm run studio:apply <file>`.
- **Whole blocks, new paragraphs, structure:** edit `src/data/site.json`
  directly. Studio edits text in place; it does not add or remove elements.
