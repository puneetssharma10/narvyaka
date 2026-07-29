/**
 * Shared plumbing for every Pages Function.
 *
 * The guiding rule: when a binding is missing, say exactly which one and how
 * to add it. A contributor should never see "500 Internal Server Error"
 * because a bucket was not created.
 */

export interface Env {
  /** Cloudflare D1 — the structured record store. */
  DB?: D1Database
  /** Cloudflare R2 — audio, photographs, and the raw submission JSON. */
  MEDIA?: R2Bucket
  /** Secret. Required before the Studio can publish overrides to the live site. */
  STUDIO_TOKEN?: string
  /**
   * Secret. Only used once, by POST /api/auth/bootstrap, to create the very
   * first super_admin account. The endpoint refuses to run at all once a
   * super_admin row already exists, so this can stay set indefinitely without
   * becoming a standing risk — but removing it after first use is still fine.
   */
  BOOTSTRAP_TOKEN?: string
  /**
   * Public base URL for the R2 bucket, e.g. https://media.narvyaka.org.
   * Leave unset and media is served through this site at /media/*.
   */
  PUBLIC_MEDIA_BASE_URL?: string
  /** Set to "1" to stop accepting new submissions without taking the site down. */
  INTAKE_PAUSED?: string

  /**
   * R2's S3-compatible API credentials — only used to sign direct-to-R2
   * upload URLs (functions/api/uploads/presign.ts), so a 300 MB recording
   * never has to pass through a Function's own request-body limit. Created
   * once in the Cloudflare dashboard: R2 → Manage R2 API Tokens → Create API
   * Token (Object Read & Write, scoped to this bucket). See INTEGRATIONS.md.
   */
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET_NAME?: string

  /**
   * Secret. A JSON array of storage nodes — buckets in *other* accounts, or
   * with other providers, that this site writes to and reads from over the S3
   * API. A Cloudflare binding can only ever see this account's own buckets;
   * this is how a partner archive on the other side of the world joins in.
   * Absent means "one bucket, as before". See functions/_shared/storage-nodes.ts.
   */
  STORAGE_NODES?: string
}

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024 // 300 MB per file
export const MAX_JSON_BYTES = 1 * 1024 * 1024 // 1 MB of text is a very long record

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  })
}

export function fail(
  status: number,
  error: string,
  opts: { hint?: string; code?: string; details?: unknown } = {},
): Response {
  return json({ error, ...opts }, status)
}

/**
 * Checks the bindings a route needs. Returns a ready-made 503 when something
 * is missing, naming the binding and pointing at the setup docs.
 */
export function requireBindings(env: Env, needed: ('DB' | 'MEDIA')[]): Response | null {
  const missing = needed.filter((binding) => !env[binding])
  if (missing.length === 0) return null

  const names = missing.join(' and ')
  return fail(503, `The archive is not connected to its ${missing.length > 1 ? 'stores' : 'store'} yet.`, {
    code: 'not_configured',
    hint:
      `Missing Cloudflare binding: ${names}. ` +
      `Create them with the commands in INTEGRATIONS.md, then bind ${names} in ` +
      `Pages → Settings → Functions → Bindings. Locally, run \`npm run pages:dev\`.`,
  })
}

/** Timing-safe string comparison for the Studio token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/** Reads a JSON body with a hard size cap, so a bad actor cannot exhaust memory. */
export async function readJson(request: Request, limit = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > limit) throw new PayloadTooLarge()

  const text = await request.text()
  if (text.length > limit) throw new PayloadTooLarge()

  try {
    return JSON.parse(text)
  } catch {
    throw new BadJson()
  }
}

export class PayloadTooLarge extends Error {}
export class BadJson extends Error {}

/** Only used for rate limiting and abuse review — never stored on a record. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown'
}

/**
 * A simple fixed-window limiter backed by D1. Not bulletproof under a
 * distributed attack — Cloudflare's own rate limiting rules are the real
 * defence — but enough to stop one script filling the archive with noise.
 */
export async function rateLimit(
  env: Env,
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<{ ok: boolean; retryAfter: number }> {
  if (!env.DB) return { ok: true, retryAfter: 0 }

  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - (now % opts.windowSeconds)

  try {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, window_start, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
    )
      .bind(key, windowStart)
      .run()

    const row = await env.DB.prepare(`SELECT count FROM rate_limits WHERE key = ?1 AND window_start = ?2`)
      .bind(key, windowStart)
      .first<{ count: number }>()

    const count = row?.count ?? 1
    return { ok: count <= opts.limit, retryAfter: windowStart + opts.windowSeconds - now }
  } catch {
    // A limiter that is itself broken must not block a genuine contributor.
    return { ok: true, retryAfter: 0 }
  }
}

/** Where a stored object can be read from by a browser. */
export function publicUrlFor(env: Env, key: string, node?: { publicBaseUrl?: string } | null): string {
  // A node with its own domain is served straight from it — no hop through
  // this site, and no signature needed for something already public.
  if (node?.publicBaseUrl) return `${node.publicBaseUrl.replace(/\/+$/, '')}/${key}`
  const base = env.PUBLIC_MEDIA_BASE_URL?.replace(/\/+$/, '')
  return base ? `${base}/${key}` : `/media/${key}`
}
