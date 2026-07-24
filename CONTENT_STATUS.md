# Content status — what is real and what is not

Every visible string on this site is in `src/data/site.json`. This file records
where each piece came from, so nothing placeholder ships by accident believing
itself to be final.

Build Brief §7 asks for exactly this distinction. Read it before launch.

---

## ✅ Verbatim from the brief — do not reword

These are given text and should not be edited without a decision:

| Where | Text |
| --- | --- |
| `home.hero.tagline` | "Because No Generation Should Start From Zero." |
| `home.hero.subhead` | "What knowledge should outlive you?" |
| `footer.philosophy` | "Preserve. Connect. Continue." |
| `preserve.heading` | "A Lifetime of Learning Should Not Disappear in a Moment." |
| `recordSomeone.heading` | "Begin With Someone You Know." |
| `howItWorks.audioHeading` | "Video Can Wait. Wisdom Cannot." |
| `about.stage1.name` | "Nar + Vyakta. A human being's knowledge, made known." |
| `browse.emptyHeading` + `browse.sparseNote` | "This archive is just beginning." / "Here is what's here so far." |
| `home.founderLine.quote` | "My great-grandfather and grandfather passed away before I was old enough to ask the right questions." |
| `home.problem.paragraphs.0` (opening) | "Every day, people leave this world carrying knowledge that exists nowhere else…" |
| `preserve.test.*` | The five Narvyaka Test questions |
| `forms.record.questions.*.label` | The eight interview questions (Build Brief §5.3) |
| `forms.review.levels.*` | The eight access levels (Part VI.2) |
| `howItWorks.verification.*.status` | The three verification statuses (Part VII.1) |

---

## ✍️ Written for this build — replace with the Master Reference where it differs

The brief quotes some passages only in part, and the Master Reference itself was
not in the repository when this was built. The following were written to match
the register and the stated policy. **They are not quotations.** Where the
Master Reference has its own wording, paste it in — the meaning should already
match, but the words are ours, not the source's.

| Key | Note |
| --- | --- |
| `home.problem.paragraphs.1–2` | Only the opening line was given; these continue it. |
| `about.stage1.mission` / `.vision` / `.belief` | Consistent with Part I.1, not quoted from it. |
| `about.stage2.figures.*` | Narada / Vyasa / Kakabhushundi, described by their function in transmitting knowledge. Check against the Master Reference's own framing. |
| `howItWorks.*` | The four parts, the audio-first argument, the three representations, review, verification. |
| `recordSomeone.*`, `volunteer.*` | Roles, guidance and expectations, per Part IX. |
| `forms.consent.points.*` | Plain-language consent text. Must not contradict the reviewed privacy policy. |
| `preserve.intro`, `preserve.timeNote` | Framing copy. |

---

## ⚠️ Placeholder — clearly labelled in the UI

Each of these renders a visible "Placeholder" or "Example" notice on the page.
The notice disappears automatically when you set `isPlaceholder: false`.

### `/founder` — `founder.letter`
**Replace with Appendix B of the Master Reference, verbatim.**
The current text is a stand-in built around the one real sentence that was
given. It reads plausibly, which is exactly why it must not stay: it is not the
founder's letter. Set `founder.isPlaceholder` to `false` once replaced.

### `/privacy` and `/terms`
Marked *pending legal review* (Part XV) and set to `noindex`. The commitments
described are accurate to how the system is actually built — they are what the
reviewed policy must not contradict. Set `isPlaceholder: false` and fill in
`lastUpdated` after review.

### Homepage hero capsule
Labelled **Example**, with the note "It is not a real contributor's record."
Replace with the first real recording: set `home.exampleCapsule.audioSrc`,
`.photo`, `.lesson`, `.attribution`, and change `.badge` from "Example".

### `content/capsules/example.json`
Not a real contributor. Excluded from `/browse`, labelled "Example" on its own
page. **Delete it once a real record is published.**

### Placeholder imagery
`public/placeholder-capsule.svg` and `public/placeholder-portrait.svg` are
drawn, not photographed — deliberately, so no stock photo of strangers is ever
implied to be a contributor (Build Brief §2.5). Replace via Studio → click the
picture.

---

## 🔧 Invented and needing a decision

### `categories` in `src/data/site.json`
Master Reference Part X defines the Primary Category list. It was not available
when this was built, so the fifteen categories there are a **working guess**.

They are low-risk today — `/browse` hides the filter below 15 records, and no
form asks a contributor to choose one — but replace them with the real list
before classifying anything, because reclassifying an archive later is painful.

### `experienceTypes`
Same situation: Method / Mistake / Decision / Skill / Memory / Lesson, taken
from the wording of the central prompt.

---

## Two things that must not drift

**Verification status has exactly three values.** They are enforced in three
places — `shared/record-schema.ts`, the `CHECK` constraint in `db/schema.sql`,
and `VerificationBadge.astro`. There is no "unverified" default and there must
not be one: an unsupported account is a *Contributor's Account*, which is a real
status, not a lesser one (Part VII.1).

**Nothing publishes itself.** Every submission is written as `pending_review`,
and the API has no path that sets anything else. Publication is a person copying
a file and rebuilding (Part IX.4).

---

## Where to edit

- **Small wording changes:** `/studio` → turn editing on → click the text →
  Export → `npm run studio:apply <file>`.
- **Whole blocks, new paragraphs, structure:** edit `src/data/site.json`
  directly. Studio edits text in place; it does not add or remove elements.
