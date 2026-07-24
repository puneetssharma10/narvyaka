# Wisdom Records

One JSON file per published record, named `<id>.json`. This is the Phase 1
content store — no database is involved in rendering the site (Build Brief §1,
Master Reference Part XI.2).

## Adding a record

1. A record arrives through `/preserve` and lands in D1 + R2 with the status
   `pending_review`. Nothing here happens automatically.
2. A person reviews it, confirms it with the contributor, and sets the
   verification status — one of exactly three values:
   `Documented`, `Contributor's Account`, `Family Tradition`.
3. Export the approved record, set `"status": "published"`, drop the file in
   this folder, put the audio and photographs in `public/media/<id>/`, and
   rebuild.

The file must match the schema in `shared/record-schema.ts`. Anything that
does not parse is skipped with a build warning rather than breaking the build.

## What gets shown publicly

`/browse` and `/capsule/[id]` only ever render a record where **both** are true:

- `status` is `published`
- `access.level` is `public` or `public_anonymous`

A record at any other access level can sit in this folder safely — it simply
will not render. `public_anonymous` strips the contributor's name, location and
profession at render time; it is not enough to leave those fields blank.

## `example.json`

Not a real contributor. It exists so the capsule template can be seen and
tested before the first real recording is made. It is excluded from `/browse`,
labelled "Example" wherever it appears, and should be deleted once a real
record is published.
