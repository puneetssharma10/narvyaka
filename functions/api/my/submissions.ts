import { getSession } from '../../_shared/auth'
import { fail, json, requireBindings, type Env } from '../../_shared/env'

/** GET /api/my/submissions — the records the signed-in user submitted themselves. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  if (!session) return fail(401, 'Please sign in to continue.', { code: 'unauthenticated' })

  const rows = await env.DB!.prepare(
    `SELECT id, status, submitted_at, contributor_name, key_lesson, access_level, photo_count, has_audio
     FROM submissions WHERE owner_user_id = ?1 ORDER BY submitted_at DESC`,
  )
    .bind(session.id)
    .all()

  return json({ submissions: rows.results ?? [] })
}
