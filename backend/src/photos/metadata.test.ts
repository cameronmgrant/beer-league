import { describe, expect, it } from 'vitest'
import { IANAZone } from 'luxon'
import { resolvePostTime } from '../resolve-post-time.js'
import {
  gps,
  photoWith,
  plainJpeg,
  plainPng,
  plainWebp,
} from '../test/photos.js'
import { seeded } from '../test/random.js'
import {
  cleanExifDateTime,
  cleanExifOffset,
  readPhotoMetadata,
  type PhotoMetadata,
} from './metadata.js'

describe('cleanExifDateTime', () => {
  it.each([
    ['a normal EXIF date', '2026:01:15 09:42:10', '2026:01:15 09:42:10'],
    ['spaces around it', '  2026:01:15 09:42:10  ', '2026:01:15 09:42:10'],
    [
      'a trailing NUL character, which some cameras write',
      '2026:01:15 09:42:10\u0000',
      '2026:01:15 09:42:10',
    ],
    [
      'an all-zero placeholder, left for the time reader to reject',
      '0000:00:00 00:00:00',
      '0000:00:00 00:00:00',
    ],
  ])('keeps %s', (_name, input, expected) => {
    expect(cleanExifDateTime(input)).toBe(expected)
  })

  it.each([
    ['text that is not a date', 'not a date'],
    ['dashes instead of colons', '2026-01-15 09:42:10'],
    ['a date with no time', '2026:01:15'],
    ['a time with no seconds', '2026:01:15 09:42'],
    ['extra text after the time', '2026:01:15 09:42:10 PM'],
    ['a blank placeholder', '    :  :     :  :  '],
    ['an empty string', ''],
    ['a very long string', '2026:01:15 09:42:10'.repeat(1000)],
    ['a number', 20260115],
    ['a date object', new Date('2026-01-15T09:42:10Z')],
    ['a list', ['2026:01:15 09:42:10']],
    ['null', null],
    ['undefined', undefined],
  ])('drops %s', (_name, input) => {
    expect(cleanExifDateTime(input)).toBeUndefined()
  })
})

describe('cleanExifOffset', () => {
  it.each([
    ['an offset ahead of UTC', '+09:00', '+09:00'],
    ['an offset behind UTC', '-05:00', '-05:00'],
    ['zero', '+00:00', '+00:00'],
    ['an offset with a trailing NUL character', '+09:00\u0000', '+09:00'],
    ['spaces around it', ' -05:00 ', '-05:00'],
  ])('keeps %s', (_name, input, expected) => {
    expect(cleanExifOffset(input)).toBe(expected)
  })

  it.each([
    ['the letter Z', 'Z'],
    ['an offset without a colon', '+0900'],
    ['an offset with one digit for the hours', '+9:00'],
    ['an offset with seconds', '+09:00:00'],
    ['a named zone', 'UTC+9'],
    ['an empty string', ''],
    ['a number', 9],
    ['null', null],
    ['undefined', undefined],
  ])('drops %s', (_name, input) => {
    expect(cleanExifOffset(input)).toBeUndefined()
  })
})

function expectClean(metadata: PhotoMetadata) {
  const allowed = ['exifDateTime', 'exifOffset', 'photoTimeZone']
  expect(Object.keys(metadata).every((key) => allowed.includes(key))).toBe(true)
  if (metadata.exifDateTime !== undefined) {
    expect(metadata.exifDateTime).toMatch(
      /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/,
    )
  }
  if (metadata.exifOffset !== undefined) {
    expect(metadata.exifOffset).toMatch(/^[+-]\d{2}:\d{2}$/)
  }
  if (metadata.photoTimeZone !== undefined) {
    expect(IANAZone.isValidZone(metadata.photoTimeZone)).toBe(true)
  }
}

describe('readPhotoMetadata: the capture time', () => {
  it('reads the time as the text on the photo, without converting it', async () => {
    const photo = await photoWith({
      IFD2: { DateTimeOriginal: '2026:01:15 09:42:10' },
    })

    expect(await readPhotoMetadata(photo)).toEqual({
      exifDateTime: '2026:01:15 09:42:10',
    })
  })

  it('reads the offset stored beside the time', async () => {
    const photo = await photoWith({
      IFD2: {
        DateTimeOriginal: '2026:01:15 22:30:00',
        OffsetTimeOriginal: '+09:00',
      },
    })

    expect(await readPhotoMetadata(photo)).toEqual({
      exifDateTime: '2026:01:15 22:30:00',
      exifOffset: '+09:00',
    })
  })

  it('falls back to the digitized time, with the offset that belongs to it', async () => {
    const photo = await photoWith({
      IFD2: {
        DateTimeDigitized: '2026:01:15 08:00:00',
        OffsetTimeDigitized: '-05:00',
      },
    })

    expect(await readPhotoMetadata(photo)).toEqual({
      exifDateTime: '2026:01:15 08:00:00',
      exifOffset: '-05:00',
    })
  })

  it('prefers the original time, and ignores an offset that belongs to the other one', async () => {
    const photo = await photoWith({
      IFD2: {
        DateTimeOriginal: '2026:01:15 09:42:10',
        DateTimeDigitized: '2026:01:15 09:42:11',
        OffsetTimeDigitized: '+09:00',
      },
    })

    expect(await readPhotoMetadata(photo)).toEqual({
      exifDateTime: '2026:01:15 09:42:10',
    })
  })

  it.each([
    ['a JPEG without any metadata', plainJpeg],
    ['a PNG', plainPng],
    ['a WebP', plainWebp],
  ])('finds nothing in %s', async (_name, make) => {
    expect(await readPhotoMetadata(await make())).toEqual({})
  })
})

describe('readPhotoMetadata: the location', () => {
  it.each([
    ['New York', 40.7128, -74.006, 'America/New_York'],
    ['Tokyo', 35.6762, 139.6503, 'Asia/Tokyo'],
    ['London', 51.5074, -0.1278, 'Europe/London'],
    ['Sydney, south and east', -33.8688, 151.2093, 'Australia/Sydney'],
    ['São Paulo, south and west', -23.5505, -46.6333, 'America/Sao_Paulo'],
  ])(
    'turns the coordinates of %s into its time zone',
    async (_name, lat, lon, zone) => {
      const photo = await photoWith({ IFD3: gps(lat, lon) })

      expect(await readPhotoMetadata(photo)).toEqual({ photoTimeZone: zone })
    },
  )

  it('returns the time and the zone together', async () => {
    const photo = await photoWith({
      IFD2: { DateTimeOriginal: '2026:01:15 09:42:10' },
      IFD3: gps(35.6762, 139.6503),
    })

    expect(await readPhotoMetadata(photo)).toEqual({
      exifDateTime: '2026:01:15 09:42:10',
      photoTimeZone: 'Asia/Tokyo',
    })
  })

  it.each([
    ['exactly 0, 0, a common placeholder', 0, 0],
    ['a latitude beyond the poles', 91, 10],
    ['a longitude beyond the date line', 10, 181],
  ])('ignores %s', async (_name, lat, lon) => {
    const photo = await photoWith({ IFD3: gps(lat, lon) })

    expect(await readPhotoMetadata(photo)).toEqual({})
  })

  it('never returns the coordinates themselves', async () => {
    const photo = await photoWith({ IFD3: gps(40.7128, -74.006) })

    const metadata = await readPhotoMetadata(photo)

    expect(JSON.stringify(metadata)).not.toMatch(
      /40\.7|74\.0|latitude|longitude/i,
    )
  })
})

describe('readPhotoMetadata: files that are not what they should be', () => {
  it.each([
    ['an empty file', Buffer.alloc(0)],
    ['plain text', Buffer.from('hello, I am not a photo')],
    ['five megabytes of zeros', Buffer.alloc(5 * 1024 * 1024)],
    ['a PNG header and nothing else', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['a JPEG start marker and nothing else', Buffer.from('ffd8ffe0', 'hex')],
  ])('returns nothing for %s', async (_name, input) => {
    expect(await readPhotoMetadata(input)).toEqual({})
  })

  it('copes with a photo cut off in the middle of its metadata', async () => {
    const photo = await photoWith({
      IFD2: { DateTimeOriginal: '2026:01:15 09:42:10' },
      IFD3: gps(35.6762, 139.6503),
    })

    for (const length of [20, 60, 120, 200]) {
      expectClean(await readPhotoMetadata(photo.subarray(0, length)))
    }
  })

  it('never throws, and never returns an unclean value, however the bytes are damaged', async () => {
    const random = seeded(7)
    const photo = await photoWith({
      IFD2: {
        DateTimeOriginal: '2026:01:15 09:42:10',
        OffsetTimeOriginal: '+09:00',
      },
      IFD3: gps(35.6762, 139.6503),
    })

    for (let round = 0; round < 300; round++) {
      const damaged = Buffer.from(photo)
      const edits = 1 + Math.floor(random() * 8)
      for (let i = 0; i < edits; i++) {
        damaged[Math.floor(random() * Math.min(400, damaged.length))] =
          Math.floor(random() * 256)
      }
      expectClean(await readPhotoMetadata(damaged))
    }
  })

  it('never throws on random bytes of any length', async () => {
    const random = seeded(11)

    for (let round = 0; round < 200; round++) {
      const bytes = Buffer.alloc(Math.floor(random() * 2000))
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(random() * 256)
      expectClean(await readPhotoMetadata(bytes))
    }
  })
})

describe('readPhotoMetadata with resolvePostTime', () => {
  const now = new Date('2026-01-15T20:00:00Z')
  const userTimeZone = 'America/New_York'

  it('counts a Tokyo photo in Tokyo, with no conversions by hand', async () => {
    const photo = await photoWith({
      IFD2: { DateTimeOriginal: '2026:01:15 09:42:10' },
      IFD3: gps(35.6762, 139.6503),
    })

    const result = resolvePostTime({
      ...(await readPhotoMetadata(photo)),
      userTimeZone,
      now,
    })

    expect(result).toEqual({
      ok: true,
      consumedAt: new Date('2026-01-15T00:42:10Z'),
      timeSource: 'exif',
      timeZone: 'Asia/Tokyo',
      timeZoneSource: 'photo_gps',
      localDate: '2026-01-15',
    })
  })

  it('asks for a time when the photo has none', async () => {
    const result = resolvePostTime({
      ...(await readPhotoMetadata(await plainJpeg())),
      userTimeZone,
      now,
    })

    expect(result).toEqual({ ok: false, reason: 'time_required' })
  })

  it('uses the photo time in the account zone when there is no location', async () => {
    const photo = await photoWith({
      IFD2: { DateTimeOriginal: '2026:01:15 09:42:10' },
    })

    const result = resolvePostTime({
      ...(await readPhotoMetadata(photo)),
      userTimeZone,
      now,
    })

    expect(result).toMatchObject({
      ok: true,
      consumedAt: new Date('2026-01-15T14:42:10Z'),
      timeZone: 'America/New_York',
      timeZoneSource: 'user',
    })
  })
})
