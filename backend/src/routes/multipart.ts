import { DateTime } from 'luxon'
import { z } from 'zod/v4'
import { AppError } from '../errors.js'

export function translateMultipartError(error: unknown): AppError {
  if (error instanceof AppError) return error

  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined

  switch (code) {
    case 'FST_REQ_FILE_TOO_LARGE':
      return new AppError(413, 'photo_too_large', 'That photo is too large')
    case 'FST_FILES_LIMIT':
      return new AppError(400, 'too_many_files', 'Send one photo at a time')
    case 'FST_FIELDS_LIMIT':
    case 'FST_PARTS_LIMIT':
      return new AppError(
        400,
        'too_many_fields',
        'The request has too many parts',
      )
    default:
      return new AppError(400, 'bad_upload', 'The upload could not be read')
  }
}

const MANUAL_TIME_SHAPE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

const fieldsSchema = z.strictObject({
  caption: z
    .string()
    .trim()
    .refine(
      (value) => Array.from(value).length <= 140,
      'must be at most 140 characters',
    )
    .refine(
      (value) => !value.includes('\u0000'),
      'must not contain a NUL character',
    )
    .optional(),
  manualTime: z
    .string()
    .regex(MANUAL_TIME_SHAPE, 'must look like 2026-01-15T09:42:10-05:00')
    .refine(
      (value) => DateTime.fromISO(value, { setZone: true }).isValid,
      'must be a real date and time',
    )
    .optional(),
})

export function parseUploadFields(fields: ReadonlyMap<string, string>): {
  caption: string | undefined
  manualTime: Date | undefined
} {
  const parsed = fieldsSchema.safeParse(Object.fromEntries(fields))
  if (!parsed.success) {
    throw new AppError(
      400,
      'validation_error',
      'The request is not valid',
      parsed.error.issues.map((issue) => ({
        where: 'body',
        path: issue.path.length > 0 ? `/${issue.path.join('/')}` : '',
        message: issue.message,
      })),
    )
  }

  const { caption, manualTime } = parsed.data
  return {
    caption: caption === undefined || caption === '' ? undefined : caption,
    manualTime:
      manualTime === undefined
        ? undefined
        : DateTime.fromISO(manualTime, { setZone: true }).toJSDate(),
  }
}
