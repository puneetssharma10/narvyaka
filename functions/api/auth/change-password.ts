import { getSession, hashPassword, passwordIssues, verifyPassword } from '../../_shared/auth'
import { BadJson, PayloadTooLarge, fail, json, readJson, requireBindings, type Env } from '../../_shared/env'

/** POST /api/auth/change-password — required after a temp password, optional otherwise. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  if (!session) return fail(401, 'Please sign in to continue.', { code: 'unauthenticated' })

  let body: unknown
  try {
    body = await readJson(request, 4096)
  } catch (error) {
    if (error instanceof PayloadTooLarge) return fail(413, 'That request is too large.')
    if (error instanceof BadJson) return fail(400, 'That request was not valid JSON.')
    throw error
  }

  const { currentPassword, newPassword } = (body ?? {}) as { currentPassword?: string; newPassword?: string }
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return fail(400, 'Both the current and new password are required.')
  }

  const row = await env.DB!.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
    .bind(session.id)
    .first<{ password_hash: string }>()
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return fail(401, 'That current password is not correct.')
  }

  const issues = passwordIssues(newPassword)
  if (issues.length > 0) return fail(400, 'That password is too weak.', { details: issues })

  const newHash = await hashPassword(newPassword)
  await env.DB!.prepare(`UPDATE users SET password_hash = ?1, must_change_password = 0 WHERE id = ?2`)
    .bind(newHash, session.id)
    .run()

  return json({ ok: true })
}
