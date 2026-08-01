import { getSession, requireRole } from '../../../_shared/auth'
import { BadJson, PayloadTooLarge, fail, json, readJson, requireBindings, type Env } from '../../../_shared/env'

interface UserRow {
  id: string
  role: 'super_admin' | 'admin' | 'volunteer'
  status: string
}

/**
 * PATCH /api/admin/users/:id
 * body: { action: 'revoke' | 'reactivate' | 'grant_download' | 'revoke_download' }
 *
 * Boundary (Founding Vision decision): an admin may revoke or reactivate a
 * volunteer, and nothing else — not another admin, not the super_admin.
 * Only the super_admin can act on an admin account, and no one can revoke
 * their own session out from under themselves.
 *
 * Download permission is narrower still: only the super_admin grants or
 * revokes it (an admin cannot, even for a volunteer they can otherwise
 * revoke outright), and only a volunteer can hold it at all — there is no
 * concept yet of a reader downloading anything.
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

  const { action } = (body ?? {}) as { action?: string }
  const validActions = ['revoke', 'reactivate', 'grant_download', 'revoke_download']
  if (!action || !validActions.includes(action)) {
    return fail(400, `action must be one of: ${validActions.join(', ')}.`)
  }

  if (action === 'grant_download' || action === 'revoke_download') {
    if (session!.role !== 'super_admin') {
      return fail(403, 'Only the super_admin can grant or revoke download permission.')
    }
    if (target.role !== 'volunteer') {
      return fail(400, 'Download permission only applies to a volunteer account.')
    }
    const canDownload = action === 'grant_download' ? 1 : 0
    await env.DB!.prepare(`UPDATE users SET can_download = ?1 WHERE id = ?2`).bind(canDownload, id).run()
    return json({ ok: true, canDownload: canDownload === 1 })
  }

  const status = action === 'revoke' ? 'revoked' : 'active'
  await env.DB!.prepare(`UPDATE users SET status = ?1 WHERE id = ?2`).bind(status, id).run()

  if (action === 'revoke') {
    // Revoking access means revoking it immediately — not after a session expires.
    await env.DB!.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run()
  }

  return json({ ok: true, status })
}
