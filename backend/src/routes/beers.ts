import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'
import { requireUser } from '../auth/plugin.js'
import type { Db } from '../db/client.js'
import { AppError } from '../errors.js'
import { processPhoto, type ProcessFailure } from '../photos/process.js'
import type { PhotoStorage } from '../photos/storage.js'
import { removePhoto, storePhoto } from '../photos/store-photo.js'
import { createPost } from '../posts/create-post.js'
import { postViewSchema, toPostView } from '../posts/post-view.js'
import { resolvePostTime } from '../resolve-post-time.js'
import { errorResponseSchema } from '../schemas.js'
import { routeLimit, type RateLimit } from '../security/plugin.js'
import { parseUploadFields, translateMultipartError } from './multipart.js'

interface Refusal {
  status: number
  code: string
  message: string
}

const PHOTO_REFUSALS: Record<ProcessFailure, Refusal> = {
  too_large: {
    status: 413,
    code: 'photo_too_large',
    message: 'That photo is too large',
  },
  too_many_pixels: {
    status: 413,
    code: 'photo_too_large',
    message: 'That photo has too many pixels',
  },
  unsupported_format: {
    status: 415,
    code: 'unsupported_format',
    message: 'Photos must be JPEG, PNG or WebP files',
  },
  heic_not_supported: {
    status: 415,
    code: 'heic_not_supported',
    message:
      'HEIC photos are not supported yet. Set your camera to "Most Compatible", or choose a JPEG',
  },
  invalid_image: {
    status: 422,
    code: 'invalid_image',
    message: 'That file could not be read as a photo',
  },
}

const TIME_REFUSALS: Record<'time_required' | 'future' | 'too_old', Refusal> = {
  time_required: {
    status: 422,
    code: 'time_required',
    message:
      'This photo has no time information, so enter when you had the beer',
  },
  future: {
    status: 422,
    code: 'time_in_future',
    message: 'The time cannot be in the future',
  },
  too_old: {
    status: 422,
    code: 'time_too_old',
    message: 'The time cannot be more than 7 days ago',
  },
}

function refuse({ status, code, message }: Refusal): never {
  throw new AppError(status, code, message)
}

export interface BeersRouteOptions {
  storage: PhotoStorage
  uploadRateLimit: RateLimit
  limits: { maxBytes: number; maxPixels: number }
}

export function registerBeersRoutes(
  app: FastifyInstance,
  db: Db,
  options: BeersRouteOptions,
): void {
  const api = app.withTypeProvider<ZodTypeProvider>()
  const { storage, limits } = options

  api.post(
    '/beers',
    {
      config: routeLimit(options.uploadRateLimit),
      schema: {
        summary: 'Post a beer: upload a photo and create a post',
        description:
          'Send multipart/form-data with the photo in the field "photo", an optional "caption" ' +
          '(up to 140 characters) and an optional "manualTime" (ISO 8601 with an offset, such as ' +
          "2026-01-15T09:42:10-05:00). The photo's own time is used unless manualTime is given.",
        consumes: ['multipart/form-data'],
        response: {
          201: z.object({ post: postViewSchema }),
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          413: errorResponseSchema,
          415: errorResponseSchema,
          422: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = requireUser(request)
      if (!request.isMultipart()) {
        throw new AppError(
          415,
          'multipart_required',
          'Send the photo as multipart/form-data',
        )
      }

      let photo: Buffer | undefined
      const fields = new Map<string, string>()
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'photo') {
              throw new AppError(
                400,
                'unknown_field',
                'Send the photo in the field named "photo"',
              )
            }
            if (photo !== undefined) {
              throw new AppError(
                400,
                'too_many_files',
                'Send one photo at a time',
              )
            }
            photo = await part.toBuffer()
          } else {
            if (fields.has(part.fieldname)) {
              throw new AppError(
                400,
                'duplicate_field',
                `The field "${part.fieldname}" was sent twice`,
              )
            }
            fields.set(part.fieldname, String(part.value))
          }
        }
      } catch (error) {
        throw translateMultipartError(error)
      }

      if (photo === undefined) {
        throw new AppError(
          400,
          'photo_required',
          'Attach a photo in the field named "photo"',
        )
      }
      const { caption, manualTime } = parseUploadFields(fields)

      // Everything that can be refused is checked before anything is saved.
      const processed = await processPhoto(photo, limits)
      if (!processed.ok) refuse(PHOTO_REFUSALS[processed.reason])

      const resolved = resolvePostTime({
        ...processed.photo.metadata,
        manualTime,
        userTimeZone: user.timeZone,
        now: new Date(),
      })
      if (!resolved.ok) refuse(TIME_REFUSALS[resolved.reason])

      const keys = await storePhoto(storage, processed.photo)
      try {
        const post = await createPost(db, {
          userId: user.id,
          imageKey: keys.imageKey,
          thumbKey: keys.thumbKey,
          caption,
          consumedAt: resolved.consumedAt,
          timeSource: resolved.timeSource,
          timeZone: resolved.timeZone,
          localDate: resolved.localDate,
        })
        return reply
          .header('cache-control', 'no-store')
          .status(201)
          .send({ post: toPostView(post, user.username) })
      } catch (error) {
        await removePhoto(storage, keys) // do not leave files behind for a post that was not saved
        throw error
      }
    },
  )
}
