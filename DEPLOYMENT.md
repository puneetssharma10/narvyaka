# Deployment

## The short version

```bash
npm install
npm run build
npm run pages:deploy
```

Then follow **INTEGRATIONS.md** to create the database and the bucket, and check
`/api/health` returns `"ok": true`.

---

## Running on the free Cloudflare domain

`site.config.ts` is set to `domain: 'narvyaka.pages.dev'` — the free subdomain
Cloudflare Pages gives every project. Canonical URLs, `og:url` and the sitemap
all point there, which is correct: it is the real address of the site today.

`contactEmail` and the social links are still empty, so no `mailto:` link and
no social icons are rendered anywhere. Nothing is broken and nothing is a
placeholder-shaped hole.

If your Pages project ends up on a different subdomain (Cloudflare appends a
suffix when the name is taken), put the actual one in `domain` and redeploy.

---

## The day you buy the domain

**1. Change one line in `site.config.ts`** — the first entry in the file:

```ts
export const siteConfig = {
  domain: 'narvyaka.com',            // ← was 'narvyaka.pages.dev'
  contactEmail: 'hello@narvyaka.com',// ← or leave '' until the mailbox exists
  social: {
    github: 'https://github.com/puneetssharma10/narvyaka', // ← when you're ready
    ...
  },
```

**2. Point the domain at Pages**

Cloudflare dashboard → Workers & Pages → `narvyaka` → **Custom domains** → *Set
up a custom domain*. If the domain's DNS is already on Cloudflare, this is two
clicks and the certificate is automatic.

**3. Rebuild and redeploy**

```bash
npm run build && npm run pages:deploy
```

That is the whole change. Canonical URLs, the sitemap, the email link and the
social links all turn themselves on.

---

## Deploying from GitHub instead

`.github/workflows/deploy.yml` deploys every push to `main` automatically. It
needs two repository secrets:

| Secret                  | Where to get it                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare → My Profile → API Tokens → Create → "Edit Cloudflare Workers" |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right-hand sidebar             |

Add them under **GitHub → Settings → Secrets and variables → Actions**.

The workflow also runs the type check and the build on every pull request, so a
broken change cannot reach the live site.

Alternatively, connect the repository directly in the Cloudflare dashboard
(Workers & Pages → Create → Pages → Connect to Git) and skip the workflow. Build
command `npm run build`, output directory `dist`.

---

## Local development

| Command             | What it runs                                        | Use it for                          |
| ------------------- | --------------------------------------------------- | ----------------------------------- |
| `npm run dev`       | Astro only, instant reload, **no API**              | Pages, styling, content, the Studio |
| `npm run pages:dev` | Full stack — functions, local D1 and R2             | Forms, uploads, anything API        |

With `npm run dev`, submitting a form fails with a clear message — that is
expected, not a fault. Use `pages:dev` to exercise the whole path.

First time with `pages:dev`:

```bash
npm run db:local     # create the tables in the local D1
npm run pages:dev
```

Local data lives in `.wrangler/` and is gitignored. Delete that folder to start
from nothing.

---

## Publishing a record

Nothing publishes itself. The steps are deliberately manual:

1. Read the pending record (see INTEGRATIONS.md → *Retrieving submissions*).
2. Confirm anything unclear **with the contributor**.
3. Set the verification status — one of exactly three values:
   `Documented`, `Contributor's Account`, `Family Tradition`.
4. Save the record as `content/capsules/<id>.json` with `"status": "published"`.
5. Copy its audio and photographs into place, or leave them on R2 and use those
   URLs.
6. `npm run build` and deploy.

The record appears on `/browse` and at `/capsule/<id>`. Delete
`content/capsules/example.json` once a real record is up.

A record whose `access.level` is not `public` or `public_anonymous` can sit in
that folder safely — it will not render. That is checked at build time, not by
remembering to be careful.

---

## Checks before announcing the site

```bash
npm run check            # types across the site and the functions
npm run build            # must be clean
curl https://<site>/api/health    # must return "ok": true
```

And by hand:

- [ ] `/preserve` — complete a real submission end to end
- [ ] Confirm it landed: `SELECT * FROM submissions ORDER BY submitted_at DESC LIMIT 1`
- [ ] Confirm its status is `pending_review` and **not** published
- [ ] `/volunteer` — send a test application
- [ ] `/browse` — the empty state reads as intentional
- [ ] `/capsule/example` — labelled "Example" and obviously not a real person
- [ ] `/privacy` and `/terms` — still marked as awaiting legal review
- [ ] On a phone, on a slow connection
- [ ] With JavaScript off — every page still readable

---

## Costs

At Phase 1 volumes this is free.

| Service        | Free tier                          | What would exceed it            |
| -------------- | ---------------------------------- | ------------------------------- |
| Pages          | 500 builds/month, unlimited traffic | ~17 deploys a day               |
| D1             | 5 GB, 5M reads/day                 | hundreds of thousands of records |
| R2             | 10 GB stored, no egress fees       | ~1,600 twenty-minute recordings |
| Pages Functions| 100k requests/day                  | not soon                        |

R2 charging nothing for egress is the reason it is used: an audio archive that
gets popular does not produce a surprise bill.
