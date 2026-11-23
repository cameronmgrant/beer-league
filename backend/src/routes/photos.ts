import type { FastifyInstance } from 'fastify'
import { requireUser, requireLogin } from '../auth/plugin.js'
import { AppError } from '../errors.js'
import type { PhotoStorage } from '../photos/storage.js'

// Exactly the names the app gives photos: 32 hexadecimal characters, an optional "-thumb", ".jpg".
const PHOTO_NAME = /^[0-9a-f]{32}(?:-thumb)?\.jpg$/

export function registerPhotoRoutes(
  app: FastifyInstance,
  options: { storage: PhotoStorage },
): void {
  app.get<{ Params: { name: string } }>(
    '/photos/:name',
    {
      preValidation: requireLogin,
      schema: {
        summary: 'A stored photo (JPEG), for logged-in members only',
        description:
          'Photo names are random and never reused, so the content behind a name never changes. ' +
          'Answers 401 when not logged in and 404 for any name that does not exist.',
      },
    },
    async (request, reply) => {
      requireUser(request)

      const { name } = request.params
      if (!PHOTO_NAME.test(name))
        throw new AppError(404, 'not_found', 'No such photo')

      const data = await options.storage.get(`photos/${name}`)
      if (data === undefined)
        throw new AppError(404, 'not_found', 'No such photo')

      return reply
        .type('image/jpeg')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(data)
    },
  )
}
