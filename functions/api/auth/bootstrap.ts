import { hashPassword, passwordIssues } from '../../_shared/auth'
import { newId } from '../../../shared/record-schema'
import {
  BadJson,
  PayloadTooLarge,
  fail,
  json,
  readJson,
  requireBindings,
  safeEqual,
  type Env,
} from '../../_shared/env'

/**
 * POST /api/auth/bootstrap — creates the one and only first super_admin.
 *
 * There is no signup page, on purpose: the only way into the account system
 * is either this one-time bootstrap, or an existing super_admin/admin
 * creating the next account. This endpoint checks two things before it does
 * anything — the caller knows BOOTSTRAP_TOKEN (a Cloudflare secret, set in
 * Pages → Settings → Functions once and never printed anywhere), AND no
 * super_admin exists yet. Once either is false, it refuses permanently.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  if (!env.BOOTSTRAP_TOKEN) {
    return fail(503, 'Bootstrap is not configured.', {
      code: 'not_configured',
      hint: 'Set the BOOTSTRAP_TOKEN secret in Pages → Settings → Functions, per INTEGRATIONS.md § Accounts.',
    })
  }

  const supplied = request.headers.get('x-bootstrap-token') ?? ''
  if (!safeEqual(supplied, env.BOOTSTRAP_TOKEN)) {
    return fail(403, 'That bootstrap token is not correct.')
  }

  const existing = await env.DB!.prepare(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`).first()
  if (existing) {
    return fail(409, 'A super_admin account already exists. Bootstrap can only run once.', {
      code: 'already_bootstrapped',
    })
  }

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string }
  if (typeof email !== 'string' || !email.includes('@')) {
    return fail(400, 'A valid email is required.')
  }
  if (typeof password !== 'string') {
    return fail(400, 'A password is required.')
  }

  const issues = passwordIssues(password)
  if (issues.length > 0) {
    return fail(400, 'That password is too weak.', { details: issues })
  }

  const id = newId()
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()

  await env.DB!.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, created_at)
     VALUES (?1, ?2, ?3, 'super_admin', 'active', ?4)`,
  )
    .bind(id, email.trim().toLowerCase(), passwordHash, now)
    .run()

  return json({ ok: true, email: email.trim().toLowerCase() }, 201)
}
