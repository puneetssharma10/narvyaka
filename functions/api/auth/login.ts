import { createSession, verifyPassword } from '../../_shared/auth'
import { BadJson, PayloadTooLarge, clientIp, fail, json, rateLimit, readJson, requireBindings, type Env } from '../../_shared/env'

/** POST /api/auth/login — email + password, sets an httpOnly session cookie. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const ip = clientIp(request)
  // Deliberately tight: this is the one endpoint a password-guesser would hit.
  const limit = await rateLimit(env, `login:${ip}`, { limit: 10, windowSeconds: 900 })
  if (!limit.ok) return fail(429, 'Too many attempts. Try again in a few minutes.', { code: 'rate_limited' })

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string }
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return fail(400, 'Email and password are both required.')
  }

  const user = await env.DB!.prepare(
    `SELECT id, email, password_hash, role, status, must_change_password FROM users WHERE email = ?1`,
  )
    .bind(email.trim().toLowerCase())
    .first<{
      id: string
      email: string
      password_hash: string
      role: string
      status: string
      must_change_password: number
    }>()

  // Same message whether the email doesn't exist or the password is wrong —
  // telling a caller "no such account" is a free tool for enumerating emails.
  const wrongCredentials = () => fail(401, 'That email and password do not match.', { code: 'invalid_credentials' })

  if (!user || user.status !== 'active') return wrongCredentials()

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) return wrongCredentials()

  const cookie = await createSession(env, user.id)
  await env.DB!.prepare(`UPDATE users SET last_login_at = ?1 WHERE id = ?2`)
    .bind(new Date().toISOString(), user.id)
    .run()

  return json(
    { role: user.role, mustChangePassword: user.must_change_password === 1 },
    200,
    { 'set-cookie': cookie },
  )
}
