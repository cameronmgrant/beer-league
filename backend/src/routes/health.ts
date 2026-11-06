import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'
import type { Db } from '../db/client.js'
import { AppError } from '../errors.js'
import { errorResponseSchema } from '../schemas.js'

export function registerHealthRoute(app: FastifyInstance, db: Db): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        summary: 'Check that the API and its database are working',
        response: {
          200: z.object({ status: z.literal('ok') }),
          503: errorResponseSchema,
        },
      },
    },
    async (request) => {
      try {
        await db.execute(sql`SELECT 1`)
      } catch (error) {
        request.log.error(
          { err: error },
          'health check could not reach the database',
        )
        throw new AppError(
          503,
          'database_unavailable',
          'The database is not reachable',
        )
      }
      return { status: 'ok' as const }
    },
  )
}
