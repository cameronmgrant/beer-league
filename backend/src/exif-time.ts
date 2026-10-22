export interface ExifTimeInput {
  exifDateTime?: string | undefined
  exifOffset?: string | undefined
  photoTimeZone?: string | undefined
  userTimeZone: string
}

import { DateTime } from 'luxon'
import { assertValidTimeZone } from './time-zone.js'

const EXIF_FORMAT = 'yyyy:MM:dd HH:mm:ss'

export function parseExifTime(input: ExifTimeInput): Date | undefined {
  assertValidTimeZone(input.userTimeZone)
  if (input.photoTimeZone !== undefined)
    assertValidTimeZone(input.photoTimeZone)
  if (!input.exifDateTime) return undefined

  const zone =
    offsetToZone(input.exifOffset) ?? input.photoTimeZone ?? input.userTimeZone
  const parsed = DateTime.fromFormat(input.exifDateTime.trim(), EXIF_FORMAT, {
    zone,
  })
  return parsed.isValid ? parsed.toJSDate() : undefined
}

export function offsetToZone(offset?: string): string | undefined {
  return offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? `UTC${offset}` : undefined
}
