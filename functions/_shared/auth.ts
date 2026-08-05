import { fail, type Env } from './env'

/**
 * Accounts, passwords and sessions.
 *
 * Five tiers exist; four ever have a row in `users`:
 *
 *   super_admin  You. The only role that can publish Studio edits to the
 *                live site, and the only one that can create another admin.
 *   admin        Reviews and edits any Wisdom Record, approves or revokes
 *                volunteer accounts. Cannot touch the Studio, cannot create
 *                another admin — see CONTENT_STATUS.md for why that
 *                boundary is deliberate rather than an oversight.
 *   volunteer    Can create records and edit only the ones they own
 *                (submissions.owner_user_id = their own id). Can always
 *                download what they own; everything only if can_download
 *                is set (super_admin grants/revokes it — see
 *                functions/api/admin/users/[id].ts).
 *   reader       Self-signup, no admin approval. Full view of any
 *                published record, same as a volunteer's view — never a
 *                download, regardless of anything.
 *   (anonymous)  No account at all. A teaser only, never the full record —
 *                see functions/api/capsule/[id].ts.
 *
 * Passwords are PBKDF2-SHA256 with a random salt, computed with the
 * platform's own WebCrypto — no third-party crypto dependency, nothing
 * reversible, nothing ever logged.
 */

export type Role = 'super_admin' | 'admin' | 'volunteer' | 'reader'

export interface SessionUser {
  id: string
  email: string
  role: Role
  mustChangePassword: boolean
  /** Only ever true for a volunteer — see the can_download note above. */
  canDownload: boolean
}

const SESSION_COOKIE = 'nv_session'
const SESSION_DAYS = 30
const PBKDF2_ITERATIONS = 210_000 // OWASP 2023 minimum for PBKDF2-SHA256

/* ── Passwords ───────────────────────────────────────────────────────────── */

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false

  const iterations = Number(parts[1])
  const salt = fromBase64(parts[2])
  const expected = fromBase64(parts[3])
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  const actual = await pbkdf2(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/** Rejects passwords too weak to bother hashing — checked before hashPassword. */
export function passwordIssues(password: string): string[] {
  const issues: string[] = []
  if (password.length < 10) issues.push('Use at least 10 characters.')
  if (password.length > 200) issues.push('That password is unreasonably long.')
  return issues
}

/* ── Sessions ────────────────────────────────────────────────────────────── */

/** Creates a session, returning the Set-Cookie header value — the raw token
 *  never touches the database, only its hash does. */
export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken()
  const tokenHash = await sha256Hex(token)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)

  await env.DB!.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(tokenHash, userId, now.toISOString(), expires.toISOString())
    .run()

  const cookie = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ].join('; ')

  return cookie
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || !env.DB) return
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run()
}

/** Resolves the caller's session, or null if not logged in / expired / revoked. */
export async function getSession(env: Env, request: Request): Promise<SessionUser | null> {
  if (!env.DB) return null
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null

  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.must_change_password, u.can_download
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      id: string
      email: string
      role: Role
      status: string
      must_change_password: number
      can_download: number
    }>()

  if (!row || row.status !== 'active') return null

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    canDownload: row.can_download === 1,
  }
}

/** Every protected route starts with this. Returns a ready 401/403, or null if allowed. */
export function requireRole(session: SessionUser | null, allowed: Role[]): Response | null {
  if (!session) {
    return fail(401, 'Please sign in to continue.', { code: 'unauthenticated' })
  }
  if (!allowed.includes(session.role)) {
    return fail(403, "Your account doesn't have access to this.", { code: 'forbidden' })
  }
  return null
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64Url(bytes)
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A short, human-relayable temporary password — an admin reads this to a
 *  new volunteer over phone/WhatsApp, since no email sending exists yet. */
export function generateTempPassword(): string {
  const words = ['amber', 'birch', 'coral', 'delta', 'ember', 'flint', 'grove', 'haze', 'ivory', 'juno']
  const pick = () => words[Math.floor(Math.random() * words.length)]
  const digits = Math.floor(1000 + Math.random() * 9000)
  return `${pick()}-${pick()}-${digits}`
}
