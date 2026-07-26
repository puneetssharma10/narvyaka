import { getSession, requireRole } from '../../_shared/auth'
import { json, requireBindings, type Env } from '../../_shared/env'

/** GET /api/admin/volunteers?status=pending_review — admin/super_admin only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['admin', 'super_admin'])
  if (denied) return denied

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const validStatuses = ['pending_review', 'accepted', 'declined']

  const rows =
    status && validStatuses.includes(status)
      ? await env.DB!.prepare(`SELECT * FROM volunteers WHERE status = ?1 ORDER BY submitted_at DESC`)
          .bind(status)
          .all()
      : await env.DB!.prepare(`SELECT * FROM volunteers ORDER BY submitted_at DESC`).all()

  return json({ volunteers: rows.results ?? [] })
}
