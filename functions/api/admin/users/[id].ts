import { getSession, requireRole } from '../../../_shared/auth'
import { BadJson, PayloadTooLarge, fail, json, readJson, requireBindings, type Env } from '../../../_shared/env'

interface UserRow {
  id: string
  role: 'super_admin' | 'admin' | 'volunteer' | 'user'
  status: string
}

/**
 * PATCH /api/admin/users/:id — body: { action: 'revoke' | 'reactivate' }
 *              or, super_admin only: { country: string | null }
 *
 * Boundary (Founding Vision decision): an admin may revoke or reactivate a
 * volunteer, and nothing else — not another admin, not the super_admin.
 * Only the super_admin can act on an admin account, and no one can revoke
 * their own session out from under themselves.
 *
 * Setting `country` re-scopes (or un-scopes, with null/empty) an existing
 * admin's read/write access — super_admin only, and only on an admin account.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['admin', 'super_admin'])
  if (denied) return denied

  const id = params.id as string
  if (id === session!.id) return fail(400, "You can't change your own account's access.")

  const target = await env.DB!.prepare(`SELECT id, role, status FROM users WHERE id = ?1`)
    .bind(id)
    .first<UserRow>()
  if (!target) return fail(404, 'No such account.')

  if (session!.role === 'admin' && target.role !== 'volunteer') {
    return fail(403, 'Admins can only manage volunteer accounts.')
  }

  let body: unknown
  try {
    body = await readJson(request, 1024)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { action, country } = (body ?? {}) as { action?: string; country?: string | null }

  if (country !== undefined) {
    if (session!.role !== 'super_admin' || target.role !== 'admin') {
      return fail(403, 'Only the super_admin can set an admin account\'s country scope.')
    }
    const scopedCountry = typeof country === 'string' && country.trim() ? country.trim() : null
    await env.DB!.prepare(`UPDATE users SET country = ?1 WHERE id = ?2`).bind(scopedCountry, id).run()
    return json({ ok: true, country: scopedCountry })
  }

  if (action !== 'revoke' && action !== 'reactivate') {
    return fail(400, "action must be 'revoke' or 'reactivate'.")
  }

  const status = action === 'revoke' ? 'revoked' : 'active'
  await env.DB!.prepare(`UPDATE users SET status = ?1 WHERE id = ?2`).bind(status, id).run()

  if (action === 'revoke') {
    // Revoking access means revoking it immediately — not after a session expires.
    await env.DB!.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run()
  }

  return json({ ok: true, status })
}
