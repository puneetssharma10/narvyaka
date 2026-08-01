import { getSession, requireRole } from '../../_shared/auth'
import { fail, json, requireBindings, type Env } from '../../_shared/env'

/**
 * GET /api/capsule/:id — the full published record, for any signed-in
 * account (including the read-only `user` role). Anonymous visitors get
 * only the static teaser baked into the page at build time; this is what
 * unlocks the rest client-side.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const missing = requireBindings(env, ['DB'])
  if (missing) return missing

  const session = await getSession(env, request)
  const denied = requireRole(session, ['super_admin', 'admin', 'volunteer', 'user'])
  if (denied) return denied

  const row = await env.DB!.prepare(`SELECT payload_json, status FROM submissions WHERE id = ?1`)
    .bind(params.id as string)
    .first<{ payload_json: string; status: string }>()

  // 404 either way — don't leak whether an id exists but isn't published.
  if (!row || row.status !== 'published') return fail(404, 'No such record.')

  return json({ record: JSON.parse(row.payload_json) })
}
