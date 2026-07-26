import { generateTempPassword, getSession, hashPassword, requireRole } from '../../../_shared/auth'
import { newId } from '../../../../shared/record-schema'
import {
  BadJson,
  PayloadTooLarge,
  fail,
  json,
  readJson,
  requireBindings,
  type Env,
} from '../../../_shared/env'

interface VolunteerRow {
  id: string
  status: string
  contact: string
  name: string
  user_id: string | null
}

/**
 * PATCH /api/admin/volunteers/:id — admin/super_admin only.
 *
 * body: { action: 'approve', email?: string } | { action: 'decline', notes?: string }
 *
 * Approving is the *only* way a volunteer account is created (Founding
 * Vision decision: apply, then an admin approves — never self-service, never
 * created by hand). The temp password is returned exactly once, in this
 * response, for the admin to relay by phone or message — it is never emailed
 * (no mail sender exists yet) and never logged anywhere after this.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['admin', 'super_admin'])
  if (denied) return denied

  const id = params.id as string
  const volunteer = await env.DB!.prepare(`SELECT * FROM volunteers WHERE id = ?1`)
    .bind(id)
    .first<VolunteerRow>()
  if (!volunteer) return fail(404, 'No such application.')
  if (volunteer.status !== 'pending_review') {
    return fail(409, `This application was already ${volunteer.status}.`, { code: 'already_reviewed' })
  }

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { action, email, notes } = (body ?? {}) as { action?: string; email?: string; notes?: string }
  const now = new Date().toISOString()

  if (action === 'decline') {
    await env.DB!.prepare(
      `UPDATE volunteers SET status = 'declined', reviewed_by = ?1, reviewed_at = ?2, review_notes = ?3 WHERE id = ?4`,
    )
      .bind(session!.id, now, notes ?? null, id)
      .run()
    return json({ ok: true, status: 'declined' })
  }

  if (action === 'approve') {
    const loginEmail = (email ?? (volunteer.contact.includes('@') ? volunteer.contact : '')).trim().toLowerCase()
    if (!loginEmail.includes('@')) {
      return fail(400, "This applicant's contact isn't an email address — supply one to create their login.", {
        code: 'email_required',
      })
    }

    const already = await env.DB!.prepare(`SELECT id FROM users WHERE email = ?1`).bind(loginEmail).first()
    if (already) return fail(409, 'An account already exists with that email.', { code: 'email_taken' })

    const tempPassword = generateTempPassword()
    const userId = newId()
    const passwordHash = await hashPassword(tempPassword)

    await env.DB!.prepare(
      `INSERT INTO users (id, email, password_hash, role, status, must_change_password, created_at, created_by)
       VALUES (?1, ?2, ?3, 'volunteer', 'active', 1, ?4, ?5)`,
    )
      .bind(userId, loginEmail, passwordHash, now, session!.id)
      .run()

    await env.DB!.prepare(
      `UPDATE volunteers SET status = 'accepted', reviewed_by = ?1, reviewed_at = ?2, review_notes = ?3, user_id = ?4 WHERE id = ?5`,
    )
      .bind(session!.id, now, notes ?? null, userId, id)
      .run()

    return json({ ok: true, status: 'accepted', email: loginEmail, tempPassword })
  }

  return fail(400, "action must be 'approve' or 'decline'.")
}
