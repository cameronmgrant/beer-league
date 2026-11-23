import { createSession } from '../auth/sessions.js'
import { addUser } from './factories.js'
import type { createTestApp } from './test-app.js'

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

// A user who is already logged in, created straight in the database.
export async function member(
  target: TestApp,
  username = 'alice',
  overrides: Parameters<typeof addUser>[2] = {},
) {
  const user = await addUser(target.db, username, overrides)
  const { token } = await createSession(target.db, user.id)
  return { user, token }
}

export function call(
  target: TestApp,
  method: 'GET' | 'DELETE',
  url: string,
  token?: string,
  headers: Record<string, string> = {},
) {
  return target.app.inject({
    method,
    url,
    headers,
    ...(token === undefined ? {} : { cookies: { session: token } }),
  })
}
