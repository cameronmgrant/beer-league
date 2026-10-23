import { describe, it, expect } from 'vitest'
import { resolvePostTime, type ResolveInput } from './resolve-post-time.js'

const now = new Date('2026-01-15T20:00:00Z') // 3:00 pm in New York
const userTimeZone = 'America/New_York'
const tokyo = 'Asia/Tokyo'

// Fills in the zone and the clock so each test only states what it cares about.
function resolve(overrides: Partial<ResolveInput> = {}) {
  return resolvePostTime({ userTimeZone, now, ...overrides })
}

describe('resolvePostTime: which time is used', () => {
  it('uses the EXIF time by default', () => {
    expect(resolve({ exifDateTime: '2026:01:15 09:42:10' })).toEqual({
      ok: true,
      consumedAt: new Date('2026-01-15T14:42:10Z'),
      timeSource: 'exif',
      timeZone: userTimeZone,
      timeZoneSource: 'user',
      localDate: '2026-01-15',
    })
  })

  it('asks for a time when there is no EXIF and no manual time', () => {
    expect(resolve()).toEqual({ ok: false, reason: 'time_required' })
  })

  it('asks for a time when the EXIF text is garbled', () => {
    expect(resolve({ exifDateTime: 'not a date' })).toEqual({
      ok: false,
      reason: 'time_required',
    })
  })

  it('uses a manual time when there is no EXIF', () => {
    expect(resolve({ manualTime: new Date('2026-01-15T12:00:00Z') })).toEqual({
      ok: true,
      consumedAt: new Date('2026-01-15T12:00:00Z'),
      timeSource: 'manual',
      timeZone: userTimeZone,
      timeZoneSource: 'user',
      localDate: '2026-01-15',
    })
  })

  it('lets a manual time override the EXIF time', () => {
    const result = resolve({
      exifDateTime: '2026:01:15 09:42:10',
      manualTime: new Date('2026-01-15T12:00:00Z'),
    })
    expect(result).toMatchObject({
      ok: true,
      consumedAt: new Date('2026-01-15T12:00:00Z'),
      timeSource: 'manual',
    })
  })
})

describe('resolvePostTime: which zone decides the counting day', () => {
  it("uses the photo's GPS zone", () => {
    const result = resolve({
      exifDateTime: '2026:01:15 09:42:10',
      photoTimeZone: tokyo,
    })
    expect(result).toEqual({
      ok: true,
      consumedAt: new Date('2026-01-15T00:42:10Z'),
      timeSource: 'exif',
      timeZone: tokyo,
      timeZoneSource: 'photo_gps',
      localDate: '2026-01-15', // New York would say January 14
    })
  })

  it('uses the EXIF offset when there is no GPS zone', () => {
    const result = resolve({
      exifDateTime: '2026:01:15 09:00:00',
      exifOffset: '+09:00',
    })
    expect(result).toEqual({
      ok: true,
      consumedAt: new Date('2026-01-15T00:00:00Z'),
      timeSource: 'exif',
      timeZone: 'UTC+09:00',
      timeZoneSource: 'exif_offset',
      localDate: '2026-01-15', // New York would say January 14
    })
  })

  it('prefers the GPS zone over the offset', () => {
    const result = resolve({
      exifDateTime: '2026:01:15 09:00:00',
      exifOffset: '+09:00',
      photoTimeZone: tokyo,
    })
    expect(result).toMatchObject({
      ok: true,
      timeZone: tokyo,
      timeZoneSource: 'photo_gps',
    })
  })

  it.each([
    ['with a photo zone', tokyo, tokyo, 'photo_gps', '2026-01-15'],
    ['without a photo zone', undefined, userTimeZone, 'user', '2026-01-14'],
  ])(
    'counts a manual time %s',
    (_name, photoTimeZone, timeZone, timeZoneSource, localDate) => {
      const result = resolve({
        manualTime: new Date('2026-01-15T00:30:00Z'),
        photoTimeZone,
      })
      expect(result).toMatchObject({
        ok: true,
        timeZone,
        timeZoneSource,
        localDate,
      })
    },
  )

  it.each([
    ['4:59 am', '2026:01:15 04:59:00', '2026-01-14'],
    ['5:00 am', '2026:01:15 05:00:00', '2026-01-15'],
  ])(
    'applies the 5 am cutoff in the photo zone (%s)',
    (_name, exifDateTime, localDate) => {
      const result = resolve({ exifDateTime, photoTimeZone: tokyo })
      expect(result).toMatchObject({ ok: true, localDate })
    },
  )
})

describe('resolvePostTime: the range limits', () => {
  it('rejects a photo read in the wrong zone, and accepts it once the GPS zone is known', () => {
    const exifDateTime = '2026:01:15 20:00:00'
    expect(resolve({ exifDateTime })).toEqual({ ok: false, reason: 'future' })
    expect(resolve({ exifDateTime, photoTimeZone: tokyo })).toMatchObject({
      ok: true,
      consumedAt: new Date('2026-01-15T11:00:00Z'),
      localDate: '2026-01-15',
    })
  })

  it('allows a time exactly 5 minutes in the future', () => {
    const result = resolve({ manualTime: new Date('2026-01-15T20:05:00Z') })
    expect(result).toMatchObject({ ok: true })
  })

  it('rejects a time more than 5 minutes in the future', () => {
    const result = resolve({ manualTime: new Date('2026-01-15T20:05:01Z') })
    expect(result).toEqual({ ok: false, reason: 'future' })
  })

  it('allows a time exactly 7 days old', () => {
    const result = resolve({ manualTime: new Date('2026-01-08T20:00:00Z') })
    expect(result).toMatchObject({ ok: true })
  })

  it('rejects a time older than 7 days', () => {
    const result = resolve({ manualTime: new Date('2026-01-08T19:59:59Z') })
    expect(result).toEqual({ ok: false, reason: 'too_old' })
  })

  it('rejects an EXIF time that is too old', () => {
    expect(resolve({ exifDateTime: '2026:01:01 12:00:00' })).toEqual({
      ok: false,
      reason: 'too_old',
    })
  })

  it('rejects an EXIF time in the future', () => {
    expect(resolve({ exifDateTime: '2026:01:15 16:00:00' })).toEqual({
      ok: false,
      reason: 'future',
    })
  })

  it('lets a manual time rescue a rejected EXIF time', () => {
    const result = resolve({
      exifDateTime: '2026:01:01 12:00:00',
      manualTime: new Date('2026-01-15T12:00:00Z'),
    })
    expect(result).toMatchObject({ ok: true, timeSource: 'manual' })
  })

  it('does not replace a bad manual time with the EXIF time', () => {
    const result = resolve({
      exifDateTime: '2026:01:15 09:42:10',
      manualTime: new Date('2026-01-05T20:00:00Z'),
    })
    expect(result).toEqual({ ok: false, reason: 'too_old' })
  })
})
describe('resolvePostTime: bad input', () => {
  it('throws for an invalid user zone', () => {
    expect(() =>
      resolve({
        userTimeZone: 'Not/AZone',
        manualTime: new Date('2026-01-15T12:00:00Z'),
      }),
    ).toThrow('Invalid time zone')
  })

  it('throws for an invalid manual date', () => {
    expect(() => resolve({ manualTime: new Date('nope') })).toThrow(
      'manualTime',
    )
  })

  it('throws for an invalid photo zone even when a manual time is used', () => {
    expect(() =>
      resolve({
        manualTime: new Date('2026-01-15T12:00:00Z'),
        photoTimeZone: 'Not/AZone',
      }),
    ).toThrow('Invalid time zone')
  })
})
