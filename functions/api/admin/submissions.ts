import { getSession, requireRole } from '../../_shared/auth'
import { json, requireBindings, type Env } from '../../_shared/env'

/** GET /api/admin/submissions?status=pending_review — admin/super_admin only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['admin', 'super_admin'])
  if (denied) return denied

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const validStatuses = ['pending_review', 'approved', 'published', 'withdrawn']

  const columns = `id, status, submitted_at, source, contributor_name, display_as_anonymous,
    contributor_location, country, key_lesson, access_level, verification_status, has_audio, photo_count,
    owner_user_id, age_confirmed_30_plus`

  // An unscoped admin (country IS NULL on their own account) sees everything,
  // same as a super_admin — only a country-scoped admin is filtered.
  const countryFilter = session!.role === 'admin' && session!.country ? `AND LOWER(country) = LOWER(?)` : ''
  const countryArg = session!.role === 'admin' && session!.country ? [session!.country] : []

  const rows =
    status && validStatuses.includes(status)
      ? await env.DB!.prepare(
          `SELECT ${columns} FROM submissions WHERE status = ? ${countryFilter} ORDER BY submitted_at DESC`,
        )
          .bind(status, ...countryArg)
          .all()
      : await env.DB!.prepare(`SELECT ${columns} FROM submissions WHERE 1=1 ${countryFilter} ORDER BY submitted_at DESC`)
          .bind(...countryArg)
          .all()

  return json({ submissions: rows.results ?? [] })
}
