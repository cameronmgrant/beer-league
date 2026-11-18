import exifr from 'exifr'
import { timeZoneFromCoordinates } from '../time-zone.js'

export interface PhotoMetadata {
  exifDateTime?: string | undefined
  exifOffset?: string | undefined
  photoTimeZone?: string | undefined
}

const DATE_PATTERN = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/
const OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/

function tidy(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replaceAll('\u0000', '').trim()
}

export function cleanExifDateTime(value: unknown): string | undefined {
  const text = tidy(value)
  return text !== undefined && DATE_PATTERN.test(text) ? text : undefined
}

export function cleanExifOffset(value: unknown): string | undefined {
  const text = tidy(value)
  return text !== undefined && OFFSET_PATTERN.test(text) ? text : undefined
}

const TAGS = [
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'CreateDate',
  'OffsetTimeDigitized',
]

export async function readPhotoMetadata(
  image: Uint8Array,
): Promise<PhotoMetadata> {
  const metadata: PhotoMetadata = {}

  try {
    // reviveValues: false keeps the time as the text on the photo. The library would
    // otherwise turn it into a Date, silently reading it in the server's time zone.
    const tags = await exifr.parse(image, { pick: TAGS, reviveValues: false })

    // Each time is only ever paired with the offset that was stored beside it.
    const original = cleanExifDateTime(tags?.DateTimeOriginal)
    const digitized = cleanExifDateTime(tags?.CreateDate)
    const dateTime = original ?? digitized
    const offset = cleanExifOffset(
      original !== undefined
        ? tags?.OffsetTimeOriginal
        : tags?.OffsetTimeDigitized,
    )

    if (dateTime !== undefined) {
      metadata.exifDateTime = dateTime
      if (offset !== undefined) metadata.exifOffset = offset
    }
  } catch {
    // Metadata that cannot be read is the same as no metadata.
  }

  try {
    const position = await exifr.gps(image)
    if (position) {
      const zone = timeZoneFromCoordinates(
        position.latitude,
        position.longitude,
      )
      if (zone !== undefined) metadata.photoTimeZone = zone
    }
  } catch {
    // Same here: no usable location.
  }

  return metadata
}
