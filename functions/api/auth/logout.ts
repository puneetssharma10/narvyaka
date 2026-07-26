import { clearSessionCookie, destroySession } from '../../_shared/auth'
import { json, type Env } from '../../_shared/env'

/** POST /api/auth/logout — revokes the session server-side and clears the cookie. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await destroySession(env, request)
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() })
}
