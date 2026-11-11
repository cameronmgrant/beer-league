import type { LightMyRequestResponse } from 'fastify'

// Every Set-Cookie header of a response, as text.
export function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers['set-cookie']
  if (header === undefined) return []
  return Array.isArray(header) ? header : [String(header)]
}

// The value of the session cookie a response sets, or undefined when it sets none
// (or clears it, which sends an empty value).
export function sessionTokenFrom(
  res: LightMyRequestResponse,
): string | undefined {
  for (const cookie of setCookies(res)) {
    const match = /^session=([^;]+)/.exec(cookie)
    if (match?.[1]) return match[1]
  }
  return undefined
}
