import { getSession } from '../../_shared/auth'
import { json, type Env } from '../../_shared/env'

/** GET /api/auth/me — who (if anyone) the caller is signed in as. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(env, request)
  return json({ user: session })
}
