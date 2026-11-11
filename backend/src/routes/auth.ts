import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { IANAZone } from 'luxon'
import { z } from 'zod/v4'
import { registerUser } from '../auth/register.js'
import type { Db } from '../db/client.js'
import { AppError } from '../errors.js'
import { errorResponseSchema, userResponseSchema } from '../schemas.js'
import { authenticate } from '../auth/login.js'
import {
  clearSessionCookie,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/plugin.js'
import { createSession, deleteSession } from '../auth/sessions.js'

const registerBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_]{3,20}$/,
      'must be 3 to 20 letters, digits or underscores',
    ),
  password: z.string().min(10).max(128),
  timeZone: z
    .string()
    .refine(
      (value) => IANAZone.isValidZone(value),
      'must be a valid IANA time zone',
    ),
  inviteCode: z.string().min(1).max(100),
  ageConfirmed: z.literal(true),
})

const loginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(128),
})

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Db,
  options: { cookieSecure: boolean },
): void {
  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get(
    '/auth/me',
    {
      schema: {
        summary: 'The logged-in user',
        response: { 200: userResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      return { user: requireUser(request) }
    },
  )
  api.post(
    '/auth/register',
    {
      schema: {
        summary: 'Create an account with an invite code',
        body: registerBody,
        response: {
          201: userResponseSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await registerUser(db, request.body)
      if (!result.ok) {
        if (result.reason === 'username_taken') {
          throw new AppError(
            409,
            'username_taken',
            'That username is already taken',
          )
        }
        throw new AppError(
          422,
          'invalid_invite',
          'That invite code is not valid',
        )
      }

      const session = await createSession(db, result.user.id)
      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
        options.cookieSecure,
      )
      return reply
        .header('cache-control', 'no-store')
        .status(201)
        .send({ user: result.user })
    },
  )
  api.post(
    '/auth/login',
    {
      schema: {
        summary: 'Log in with a username and password',
        body: loginBody,
        response: {
          200: userResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await authenticate(
        db,
        request.body.username,
        request.body.password,
      )
      if (!user)
        throw new AppError(
          401,
          'invalid_credentials',
          'Wrong username or password',
        )

      const session = await createSession(db, user.id)
      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
        options.cookieSecure,
      )
      reply.header('cache-control', 'no-store')
      return { user }
    },
  )
  api.post(
    '/auth/logout',
    { schema: { summary: 'Log out and end the session' } },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE]
      if (token) await deleteSession(db, token)
      clearSessionCookie(reply, options.cookieSecure)
      return reply.status(204).send()
    },
  )
}
