import { describe, it, expect } from 'vitest'
import { offsetToZone, parseExifTime, type ExifTimeInput } from './exif-time.js'

const userTimeZone = 'America/New_York'

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString()
}
describe('parseExifTime: reading the time', () => {
  const cases: Array<[string, Partial<ExifTimeInput>, string]> = [
    [
      'reads the text in the user zone by default',
      { exifDateTime: '2026:01:15 09:42:10' },
      '2026-01-15T14:42:10.000Z',
    ],
    [
      'reads the text in the photo zone when there is one',
      { exifDateTime: '2026:01:15 09:42:10', photoTimeZone: 'Asia/Tokyo' },
      '2026-01-15T00:42:10.000Z',
    ],
    [
      'uses the offset when there is one',
      { exifDateTime: '2026:01:15 22:30:00', exifOffset: '+09:00' },
      '2026-01-15T13:30:00.000Z',
    ],
    [
      'prefers the offset over the photo zone',
      {
        exifDateTime: '2026:01:15 22:30:00',
        exifOffset: '+09:00',
        photoTimeZone: 'America/Los_Angeles',
      },
      '2026-01-15T13:30:00.000Z',
    ],
    [
      'handles a negative offset',
      { exifDateTime: '2026:01:15 09:42:10', exifOffset: '-05:00' },
      '2026-01-15T14:42:10.000Z',
    ],
    [
      'ignores a junk offset and falls back to the zone',
      { exifDateTime: '2026:01:15 09:42:10', exifOffset: 'abc' },
      '2026-01-15T14:42:10.000Z',
    ],
    [
      'ignores whitespace around the text',
      { exifDateTime: ' 2026:01:15 09:42:10 ' },
      '2026-01-15T14:42:10.000Z',
    ],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(iso(parseExifTime({ userTimeZone, ...input }))).toBe(expected)
  })
})
describe('parseExifTime: unusable text', () => {
  it.each([
    ['missing text', undefined],
    ['an empty string', ''],
    ['text that is not a date', 'not a date'],
    ['the all-zero placeholder some cameras write', '0000:00:00 00:00:00'],
    ['dashes instead of colons', '2026-01-15 09:42:10'],
    ['an impossible month', '2026:13:45 09:42:10'],
  ])('returns undefined for %s', (_name, exifDateTime) => {
    expect(parseExifTime({ exifDateTime, userTimeZone })).toBeUndefined()
  })
})

describe('parseExifTime: invalid zones', () => {
  it('throws for an invalid user zone', () => {
    expect(() =>
      parseExifTime({
        exifDateTime: '2026:01:15 09:42:10',
        userTimeZone: 'Not/AZone',
      }),
    ).toThrow()
  })

  it('throws for an invalid photo zone', () => {
    expect(() =>
      parseExifTime({
        exifDateTime: '2026:01:15 09:42:10',
        photoTimeZone: 'Not/AZone',
        userTimeZone,
      }),
    ).toThrow()
  })

  it('checks the zones even when there is no EXIF text', () => {
    expect(() => parseExifTime({ userTimeZone: 'Not/AZone' })).toThrow()
  })
})

describe('offsetToZone', () => {
  it('turns an offset into a fixed zone name', () => {
    expect(offsetToZone('+09:00')).toBe('UTC+09:00')
    expect(offsetToZone('-05:00')).toBe('UTC-05:00')
  })

  it.each(['abc', '+9', '0900', ''])('returns undefined for "%s"', (offset) => {
    expect(offsetToZone(offset)).toBeUndefined()
  })

  it('returns undefined when there is no offset', () => {
    expect(offsetToZone(undefined)).toBeUndefined()
  })
})
