import fastifyCookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from '../db/client.js'
import { AppError } from '../errors.js'
import { findSession, type SessionUser } from './sessions.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}

export const SESSION_COOKIE = 'session'

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
  })
}

export async function registerAuth(
  api: FastifyInstance,
  db: Db,
  options: { cookieSecure: boolean },
): Promise<void> {
  // Wait until the cookie plugin has finished loading, so that its own request
  // hook runs before ours and request.cookies is already filled in.
  await api.register(fastifyCookie)
  api.decorateRequest('user', null)

  api.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (!token) return

    const session = await findSession(db, token)
    if (!session) return

    request.user = session.user
    if (session.extended) {
      setSessionCookie(reply, token, session.expiresAt, options.cookieSecure)
    }
  })
}

export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new AppError(401, 'unauthenticated', 'Please log in')
  return request.user
}
