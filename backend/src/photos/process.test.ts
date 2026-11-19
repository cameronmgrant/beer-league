import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { detectImageType } from './image-type.js'
import { readPhotoMetadata } from './metadata.js'
import {
  IMAGE_MAX_SIDE,
  THUMBNAIL_MAX_SIDE,
  processPhoto,
  type ProcessedPhoto,
} from './process.js'
import {
  gps,
  jpegOfSize,
  jpegWithOrientation,
  photoOfSize,
  pngOfSize,
  redBlueJpeg,
  transparentPng,
  webpOfSize,
} from '../test/photos.js'
import { seeded } from '../test/random.js'

async function mustProcess(
  input: Uint8Array,
  limits = {},
): Promise<ProcessedPhoto> {
  const result = await processPhoto(input, limits)
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`)
  return result.photo
}

async function pixelAt(
  image: Buffer,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * info.channels
  return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0]
}

describe('processPhoto: sizes', () => {
  it.each([
    ['a large landscape photo', 3000, 2000, [1600, 1067], [480, 320]],
    ['a large portrait photo', 2000, 3000, [1067, 1600], [320, 480]],
    ['a large square photo', 2400, 2400, [1600, 1600], [480, 480]],
    ['a photo exactly at the size limit', 1600, 1200, [1600, 1200], [480, 360]],
    ['a small photo, which is not enlarged', 800, 600, [800, 600], [480, 360]],
    ['a very small photo', 100, 50, [100, 50], [100, 50]],
  ])(
    'makes the right sizes for %s',
    async (_name, width, height, image, thumbnail) => {
      const photo = await mustProcess(await jpegOfSize(width, height))

      expect([photo.image.width, photo.image.height]).toEqual(image)
      expect([photo.thumbnail.width, photo.thumbnail.height]).toEqual(thumbnail)
      expect(
        Math.max(photo.image.width, photo.image.height),
      ).toBeLessThanOrEqual(IMAGE_MAX_SIDE)
      expect(
        Math.max(photo.thumbnail.width, photo.thumbnail.height),
      ).toBeLessThanOrEqual(THUMBNAIL_MAX_SIDE)
    },
  )

  it('reports sizes that match the real pictures', async () => {
    const photo = await mustProcess(await jpegOfSize(3000, 2000))

    for (const part of [photo.image, photo.thumbnail]) {
      const real = await sharp(part.data).metadata()
      expect([real.width, real.height]).toEqual([part.width, part.height])
    }
  })
})

describe('processPhoto: formats', () => {
  it.each([
    ['a JPEG', jpegOfSize],
    ['a PNG', pngOfSize],
    ['a WebP', webpOfSize],
  ])('turns %s into JPEG images', async (_name, make) => {
    const photo = await mustProcess(await make(500, 400))

    for (const part of [photo.image, photo.thumbnail]) {
      expect(detectImageType(part.data)).toBe('jpeg')
      expect((await sharp(part.data).metadata()).format).toBe('jpeg')
    }
  })

  it('fills transparent areas with white', async () => {
    const photo = await mustProcess(await transparentPng(50, 50))

    const [red, green, blue] = await pixelAt(photo.image.data, 25, 25)

    expect(Math.min(red, green, blue)).toBeGreaterThan(245)
  })
})

describe('processPhoto: metadata', () => {
  const tags = {
    IFD0: { Make: 'TestCam' },
    IFD2: {
      DateTimeOriginal: '2026:01:15 09:42:10',
      OffsetTimeOriginal: '+09:00',
    },
    IFD3: gps(35.6762, 139.6503),
  }

  it('returns the metadata of the original', async () => {
    const photo = await mustProcess(await photoOfSize(800, 600, tags))

    expect(photo.metadata).toEqual({
      exifDateTime: '2026:01:15 09:42:10',
      exifOffset: '+09:00',
      photoTimeZone: 'Asia/Tokyo',
    })
  })

  it('leaves no metadata at all in either saved image', async () => {
    const original = await photoOfSize(800, 600, tags)
    expect(original.includes(Buffer.from('Exif'))).toBe(true) // the original really does carry it

    const photo = await mustProcess(original)

    for (const part of [photo.image, photo.thumbnail]) {
      expect(await readPhotoMetadata(part.data)).toEqual({})
      const real = await sharp(part.data).metadata()
      expect(real.exif).toBeUndefined()
      expect(real.icc).toBeUndefined()
      expect(real.xmp).toBeUndefined()
      expect(real.iptc).toBeUndefined()
      expect(part.data.includes(Buffer.from('Exif'))).toBe(false)
      expect(part.data.includes(Buffer.from('TestCam'))).toBe(false)
    }
  })

  it.each([
    ['a PNG', pngOfSize],
    ['a WebP', webpOfSize],
  ])('returns empty metadata for %s without any', async (_name, make) => {
    expect((await mustProcess(await make(300, 200))).metadata).toEqual({})
  })
})

describe('processPhoto: orientation', () => {
  it.each([
    [1, 40, 20],
    [2, 40, 20],
    [3, 40, 20],
    [4, 40, 20],
    [5, 20, 40],
    [6, 20, 40],
    [7, 20, 40],
    [8, 20, 40],
  ])(
    'makes the image for orientation %i %ix%i',
    async (orientation, width, height) => {
      const photo = await mustProcess(
        await jpegWithOrientation(40, 20, orientation),
      )

      expect([photo.image.width, photo.image.height]).toEqual([width, height])
      expect(
        (await sharp(photo.image.data).metadata()).orientation,
      ).toBeUndefined()
    },
  )

  it('really rotates the pixels, not just the numbers (orientation 6)', async () => {
    const photo = await mustProcess(await redBlueJpeg(40, 20, 6))

    const [topRed, , topBlue] = await pixelAt(photo.image.data, 10, 5)
    const [bottomRed, , bottomBlue] = await pixelAt(photo.image.data, 10, 35)

    expect(topRed).toBeGreaterThan(200)
    expect(topBlue).toBeLessThan(60)
    expect(bottomBlue).toBeGreaterThan(200)
    expect(bottomRed).toBeLessThan(60)
  })

  it('rotates the other way for orientation 8', async () => {
    const photo = await mustProcess(await redBlueJpeg(40, 20, 8))

    const [topRed] = await pixelAt(photo.image.data, 10, 5)
    const [bottomRed] = await pixelAt(photo.image.data, 10, 35)

    expect(topRed).toBeLessThan(60)
    expect(bottomRed).toBeGreaterThan(200)
  })

  it('leaves an upright photo as it is (orientation 1)', async () => {
    const photo = await mustProcess(await redBlueJpeg(40, 20, 1))

    const [leftRed] = await pixelAt(photo.image.data, 5, 10)
    const [rightRed] = await pixelAt(photo.image.data, 35, 10)

    expect(leftRed).toBeGreaterThan(200)
    expect(rightRed).toBeLessThan(60)
  })
})

describe('processPhoto: refusals', () => {
  it('refuses a file over the size limit, and accepts one exactly at it', async () => {
    const photo = await jpegOfSize(400, 300)

    expect(await processPhoto(photo, { maxBytes: photo.length })).toMatchObject(
      { ok: true },
    )
    expect(await processPhoto(photo, { maxBytes: photo.length - 1 })).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  it('refuses an image with too many pixels, and accepts one exactly at the limit', async () => {
    const photo = await jpegOfSize(100, 100)

    expect(await processPhoto(photo, { maxPixels: 10_000 })).toMatchObject({
      ok: true,
    })
    expect(await processPhoto(photo, { maxPixels: 9_999 })).toEqual({
      ok: false,
      reason: 'too_many_pixels',
    })
  })

  it.each([
    ['an empty file', new Uint8Array()],
    ['plain text', Buffer.from('hello, I am not a photo')],
    ['a GIF', Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1')],
    ['an SVG with a script', Buffer.from('<svg onload="alert(1)"></svg>')],
    ['a PDF', Buffer.from('%PDF-1.7 ...')],
  ])('refuses %s as an unsupported format', async (_name, input) => {
    expect(await processPhoto(input)).toEqual({
      ok: false,
      reason: 'unsupported_format',
    })
  })

  it('refuses HEIC photos with their own reason', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic'),
      Buffer.alloc(200),
    ])

    expect(await processPhoto(heic)).toEqual({
      ok: false,
      reason: 'heic_not_supported',
    })
  })

  it.each([
    [
      'a JPEG header followed by garbage',
      Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(500, 7)]),
    ],
    ['a PNG header and nothing else', Buffer.from('89504e470d0a1a0a', 'hex')],
  ])('refuses %s as an invalid image', async (_name, input) => {
    expect(await processPhoto(input)).toEqual({
      ok: false,
      reason: 'invalid_image',
    })
  })

  it('refuses a photo cut off partway through', async () => {
    const photo = await jpegOfSize(1000, 800)
    const cut = photo.subarray(0, Math.floor(photo.length / 2))

    const result = await processPhoto(cut)

    expect(result.ok).toBe(false)
  })
})

describe('processPhoto: damaged and unusual input', () => {
  it('never throws, and always returns a valid answer, however the bytes are damaged', async () => {
    const random = seeded(21)
    const originals = [
      await jpegOfSize(120, 90),
      await pngOfSize(120, 90),
      await webpOfSize(120, 90),
    ]

    for (let round = 0; round < 150; round++) {
      const original = originals[round % originals.length] ?? originals[0]
      const damaged = Buffer.from(original ?? Buffer.alloc(0))
      const edits = 1 + Math.floor(random() * 6)
      for (let i = 0; i < edits; i++) {
        damaged[Math.floor(random() * damaged.length)] = Math.floor(
          random() * 256,
        )
      }

      const result = await processPhoto(damaged)

      if (result.ok) {
        expect(detectImageType(result.photo.image.data)).toBe('jpeg')
        expect(await readPhotoMetadata(result.photo.image.data)).toEqual({})
      } else {
        expect([
          'unsupported_format',
          'heic_not_supported',
          'invalid_image',
          'too_many_pixels',
          'too_large',
        ]).toContain(result.reason)
      }
    }
  })

  it('handles many photos at the same time', async () => {
    const photo = await jpegOfSize(900, 600)

    const results = await Promise.all(
      Array.from({ length: 20 }, () => processPhoto(photo)),
    )

    expect(results.every((result) => result.ok)).toBe(true)
  })
})
