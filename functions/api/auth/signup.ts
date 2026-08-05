import { createSession, hashPassword, passwordIssues } from '../../_shared/auth'
import { newId } from '../../../shared/record-schema'
import {
  BadJson,
  PayloadTooLarge,
  clientIp,
  fail,
  json,
  rateLimit,
  readJson,
  requireBindings,
  type Env,
} from '../../_shared/env'

/**
 * POST /api/auth/signup — self-service, no approval: creates a reader
 * account. This is the only self-signup route in the system — a volunteer or
 * admin account is always created by someone else (see bootstrap.ts and
 * admin/users.ts) — a reader is a plain registered visitor and nothing more.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const ip = clientIp(request)
  const limit = await rateLimit(env, `signup:${ip}`, { limit: 8, windowSeconds: 3600 })
  if (!limit.ok) return fail(429, 'Too many attempts. Try again in a while.', { code: 'rate_limited' })

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string }
  const loginEmail = (email ?? '').trim().toLowerCase()
  if (!loginEmail.includes('@')) return fail(400, 'A valid email is required.')
  if (typeof password !== 'string') return fail(400, 'A password is required.')

  const issues = passwordIssues(password)
  if (issues.length > 0) return fail(400, 'That password is too weak.', { details: issues })

  const already = await env.DB!.prepare(`SELECT id FROM users WHERE email = ?1`).bind(loginEmail).first()
  if (already) return fail(409, 'An account already exists with that email.', { code: 'email_taken' })

  const id = newId()
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()

  await env.DB!.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, created_at)
     VALUES (?1, ?2, ?3, 'reader', 'active', ?4)`,
  )
    .bind(id, loginEmail, passwordHash, now)
    .run()

  const cookie = await createSession(env, id)
  return json({ role: 'reader' }, 201, { 'set-cookie': cookie })
}
