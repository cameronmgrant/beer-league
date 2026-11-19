import type { PhotoMetadata } from './metadata.js'
import sharp from 'sharp'
import { detectImageType } from './image-type.js'
import { readPhotoMetadata } from './metadata.js'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_PIXELS = 100_000_000
export const IMAGE_MAX_SIDE = 1600
export const THUMBNAIL_MAX_SIDE = 480

export interface ProcessedImage {
  data: Buffer
  width: number
  height: number
}

export interface ProcessedPhoto {
  metadata: PhotoMetadata
  image: ProcessedImage
  thumbnail: ProcessedImage
}

export type ProcessFailure =
  | 'too_large'
  | 'unsupported_format'
  | 'heic_not_supported'
  | 'too_many_pixels'
  | 'invalid_image'

export type ProcessResult =
  { ok: true; photo: ProcessedPhoto } | { ok: false; reason: ProcessFailure }

export interface ProcessLimits {
  maxBytes?: number | undefined
  maxPixels?: number | undefined
}

export async function processPhoto(
  input: Uint8Array,
  limits: ProcessLimits = {},
): Promise<ProcessResult> {
  const maxBytes = limits.maxBytes ?? MAX_UPLOAD_BYTES
  const maxPixels = limits.maxPixels ?? MAX_PIXELS

  if (input.byteLength > maxBytes) return { ok: false, reason: 'too_large' }

  const type = detectImageType(input)
  if (type === 'heic') return { ok: false, reason: 'heic_not_supported' }
  if (type === 'unknown') return { ok: false, reason: 'unsupported_format' }

  try {
    // Reading the header is cheap: it tells us the size without decoding any pixels.
    const header = await sharp(input, { limitInputPixels: false }).metadata()
    const pixels = (header.width ?? 0) * (header.height ?? 0)
    if (pixels === 0) return { ok: false, reason: 'invalid_image' }
    if (pixels > maxPixels) return { ok: false, reason: 'too_many_pixels' }

    // The metadata is read from the original, before the pictures below discard it.
    const metadata = await readPhotoMetadata(input)

    // Rotate the pixels according to the orientation tag now, because the tag is about to go.
    const base = sharp(input, { limitInputPixels: maxPixels })
      .rotate()
      .flatten({ background: '#ffffff' })

    const [image, thumbnail] = await Promise.all([
      base
        .clone()
        .resize({
          width: IMAGE_MAX_SIDE,
          height: IMAGE_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true }),
      base
        .clone()
        .resize({
          width: THUMBNAIL_MAX_SIDE,
          height: THUMBNAIL_MAX_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 75 })
        .toBuffer({ resolveWithObject: true }),
    ])

    return {
      ok: true,
      photo: {
        metadata,
        image: {
          data: image.data,
          width: image.info.width,
          height: image.info.height,
        },
        thumbnail: {
          data: thumbnail.data,
          width: thumbnail.info.width,
          height: thumbnail.info.height,
        },
      },
    }
  } catch {
    return { ok: false, reason: 'invalid_image' }
  }
}
