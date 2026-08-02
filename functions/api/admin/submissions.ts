import { getSession, requireRole } from '../../_shared/auth'
import { json, requireBindings, type Env } from '../../_shared/env'

/**
 * GET /api/admin/submissions?status=pending_review — admin/super_admin only.
 *
 * The super_admin sees everything, unconditionally. An admin sees only
 * records whose contributor_country matches their own assigned country —
 * plus anything with no country set at all, since an old or not-yet-filled
 * record shouldn't become invisible to every admin just because that field
 * is empty (see db/schema.sql's note on users.country for the same call
 * made the other direction, for an unassigned admin).
 */
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
    contributor_location, contributor_country, key_lesson, access_level, verification_status,
    has_audio, photo_count, owner_user_id, age_confirmed_30_plus`

  // Plain, unnumbered "?" placeholders — D1 binds them positionally in the
  // order .bind() receives them, so building the condition list and the
  // bindings array in lockstep (below) is all that's needed; no manual
  // numbering to keep in sync.
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (status && validStatuses.includes(status)) {
    conditions.push(`status = ?`)
    bindings.push(status)
  }
  if (session!.role === 'admin') {
    conditions.push(`(contributor_country = ? OR contributor_country IS NULL)`)
    bindings.push(session!.country)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const stmt = env.DB!.prepare(`SELECT ${columns} FROM submissions ${where} ORDER BY submitted_at DESC`)
  const rows = await (bindings.length ? stmt.bind(...bindings) : stmt).all()

  return json({ submissions: rows.results ?? [] })
}
