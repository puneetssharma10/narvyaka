import { generateTempPassword, getSession, hashPassword, requireRole } from '../../_shared/auth'
import { newId } from '../../../shared/record-schema'
import {
  BadJson,
  PayloadTooLarge,
  fail,
  json,
  readJson,
  requireBindings,
  type Env,
} from '../../_shared/env'

/** GET /api/admin/users — admin/super_admin only. Volunteer accounts are managed
 *  through /api/admin/volunteers instead; this is mainly the admin/super_admin roster. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['admin', 'super_admin'])
  if (denied) return denied

  const rows = await env.DB!.prepare(
    `SELECT id, email, role, status, country, created_at, last_login_at FROM users ORDER BY created_at DESC`,
  ).all()

  return json({ users: rows.results ?? [] })
}

/**
 * POST /api/admin/users — super_admin only: creates another admin account.
 *
 * Deliberately narrow: this is the *only* way an admin account is created —
 * there is no self-service admin signup, and admins cannot create other
 * admins (Founding Vision decision — only you decide who else can touch
 * every record and every volunteer account).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['super_admin'])
  if (denied) return denied

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { email, country } = (body ?? {}) as { email?: string; country?: string }
  const loginEmail = (email ?? '').trim().toLowerCase()
  if (!loginEmail.includes('@')) return fail(400, 'A valid email is required.')
  const scopedCountry = typeof country === 'string' && country.trim() ? country.trim() : null

  const already = await env.DB!.prepare(`SELECT id FROM users WHERE email = ?1`).bind(loginEmail).first()
  if (already) return fail(409, 'An account already exists with that email.', { code: 'email_taken' })

  const tempPassword = generateTempPassword()
  const userId = newId()
  const passwordHash = await hashPassword(tempPassword)
  const now = new Date().toISOString()

  await env.DB!.prepare(
    `INSERT INTO users (id, email, password_hash, role, status, must_change_password, created_at, created_by, country)
     VALUES (?1, ?2, ?3, 'admin', 'active', 1, ?4, ?5, ?6)`,
  )
    .bind(userId, loginEmail, passwordHash, now, session!.id, scopedCountry)
    .run()

  return json({ ok: true, email: loginEmail, tempPassword }, 201)
}
