export type TimeSource = 'exif' | 'manual'
export type TimeZoneSource = 'photo_gps' | 'exif_offset' | 'user'

export interface ResolveInput {
  exifDateTime?: string | undefined
  exifOffset?: string | undefined
  photoTimeZone?: string | undefined
  manualTime?: Date | undefined
  userTimeZone: string
  now: Date
}

export type ResolveResult =
  | {
      ok: true
      consumedAt: Date
      timeSource: TimeSource
      timeZone: string
      timeZoneSource: TimeZoneSource
      localDate: string
    }
  | { ok: false; reason: 'time_required' | 'future' | 'too_old' }

import { getLocalDate } from './local-date.js'
import { offsetToZone, parseExifTime } from './exif-time.js'
import { assertValidTimeZone } from './time-zone.js'

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function resolvePostTime(input: ResolveInput): ResolveResult {
  let consumedAt: Date | undefined
  let timeSource: TimeSource
  assertValidTimeZone(input.userTimeZone)
  if (input.photoTimeZone !== undefined)
    assertValidTimeZone(input.photoTimeZone)

  if (input.manualTime !== undefined) {
    if (Number.isNaN(input.manualTime.getTime())) {
      throw new Error('manualTime is not a valid date')
    }
    consumedAt = input.manualTime
    timeSource = 'manual'
  } else {
    consumedAt = parseExifTime(input)
    timeSource = 'exif'
  }

  if (!consumedAt) return { ok: false, reason: 'time_required' }

  const nowMs = input.now.getTime()
  if (consumedAt.getTime() > nowMs + FUTURE_TOLERANCE_MS)
    return { ok: false, reason: 'future' }
  if (consumedAt.getTime() < nowMs - MAX_AGE_MS)
    return { ok: false, reason: 'too_old' }

  const { timeZone, timeZoneSource } = pickCountingZone(input)

  return {
    ok: true,
    consumedAt,
    timeSource,
    timeZone,
    timeZoneSource,
    localDate: getLocalDate(consumedAt, timeZone),
  }
}

function pickCountingZone(input: ResolveInput): {
  timeZone: string
  timeZoneSource: TimeZoneSource
} {
  if (input.photoTimeZone !== undefined) {
    return { timeZone: input.photoTimeZone, timeZoneSource: 'photo_gps' }
  }
  const offsetZone = offsetToZone(input.exifOffset)
  if (offsetZone !== undefined) {
    return { timeZone: offsetZone, timeZoneSource: 'exif_offset' }
  }
  return { timeZone: input.userTimeZone, timeZoneSource: 'user' }
}
