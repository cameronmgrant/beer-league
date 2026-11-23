import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { DateTime } from 'luxon'
import { z } from 'zod/v4'
import { requireUser, requireLogin } from '../auth/plugin.js'
import type { Db } from '../db/client.js'
import { getLocalDate } from '../local-date.js'
import { getLeaderboard, getUserCounts } from '../posts/counts.js'
import { periodRange } from '../posts/period-range.js'
import { errorResponseSchema } from '../schemas.js'

const statsResponse = z.object({
  today: z.string(),
  day: z.number().int(),
  month: z.number().int(),
  year: z.number().int(),
})

const leaderboardQuery = z.object({
  period: z.enum(['day', 'month', 'year']),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like 2026-01-15')
    .refine(
      (value) => DateTime.fromISO(value, { zone: 'utc' }).isValid,
      'must be a real date',
    )
    .optional(),
})

const leaderboardResponse = z.object({
  period: z.enum(['day', 'month', 'year']),
  date: z.string(),
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      rank: z.number().int(),
      userId: z.number().int(),
      username: z.string(),
      count: z.number().int(),
    }),
  ),
})

export function registerStatsRoutes(
  app: FastifyInstance,
  db: Db,
  options: { now: () => Date },
): void {
  const api = app.withTypeProvider<ZodTypeProvider>()

  api.get(
    '/stats/me',
    {
      preValidation: requireLogin,
      schema: {
        summary: 'Your totals for today, this month and this year',
        response: { 200: statsResponse, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request)
      const today = getLocalDate(options.now(), user.timeZone)
      const counts = await getUserCounts(db, user.id, today)

      reply.header('cache-control', 'no-store')
      return { today, ...counts }
    },
  )

  api.get(
    '/stats/leaderboard',
    {
      preValidation: requireLogin,
      schema: {
        summary: 'Everyone\u2019s counts for a day, a month or a year',
        querystring: leaderboardQuery,
        response: {
          200: leaderboardResponse,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request)
      const { period, date } = request.query
      const anchor = date ?? getLocalDate(options.now(), user.timeZone)

      const { from, to } = periodRange(period, anchor)
      const rows = await getLeaderboard(db, period, anchor)

      reply.header('cache-control', 'no-store')
      return {
        period,
        date: anchor,
        from,
        to,
        rows: rows.map(({ rank, userId, username, count }) => ({
          rank,
          userId,
          username,
          count,
        })),
      }
    },
  )
}
