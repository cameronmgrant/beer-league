import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'
import { requireUser, requireLogin } from '../auth/plugin.js'
import type { Db } from '../db/client.js'
import { AppError } from '../errors.js'
import { InvalidCursorError } from '../posts/feed-cursor.js'
import { getFeed, MAX_PAGE_SIZE } from '../posts/feed.js'
import { postViewSchema, toPostView } from '../posts/post-view.js'
import { errorResponseSchema } from '../schemas.js'

const feedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(300).optional(),
})

export function registerFeedRoute(app: FastifyInstance, db: Db): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/feed',
    {
      preValidation: requireLogin,
      schema: {
        summary: 'One page of the feed, newest first',
        querystring: feedQuery,
        response: {
          200: z.object({
            posts: z.array(postViewSchema),
            nextCursor: z.string().nullable(),
          }),
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      requireUser(request)
      const { limit, cursor } = request.query

      let page
      try {
        page = await getFeed(db, { limit, cursor })
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw new AppError(400, 'invalid_cursor', 'That cursor is not valid')
        }
        throw error
      }

      reply.header('cache-control', 'no-store')
      return {
        posts: page.posts.map(({ username, ...post }) =>
          toPostView(post, username),
        ),
        nextCursor: page.nextCursor,
      }
    },
  )
}
