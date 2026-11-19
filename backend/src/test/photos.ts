import sharp from 'sharp'

type Tags = Record<string, string>

export interface ExifSpec {
  IFD0?: Tags
  IFD2?: Tags // the "Exif" block, which holds the capture times
  IFD3?: Tags // the GPS block
}

// Writes a decimal coordinate the way EXIF stores it: degrees, minutes and seconds as fractions.
function dms(value: number): string {
  const degrees = Math.floor(value)
  const minutesExact = (value - degrees) * 60
  const minutes = Math.floor(minutesExact)
  const seconds = Math.round((minutesExact - minutes) * 60 * 100)
  return `${degrees}/1 ${minutes}/1 ${seconds}/100`
}

export function gps(latitude: number, longitude: number): Tags {
  return {
    GPSLatitudeRef: latitude >= 0 ? 'N' : 'S',
    GPSLatitude: dms(Math.abs(latitude)),
    GPSLongitudeRef: longitude >= 0 ? 'E' : 'W',
    GPSLongitude: dms(Math.abs(longitude)),
  }
}

const blank = () =>
  sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })

export function photoWith(exif: ExifSpec): Promise<Buffer> {
  return blank().jpeg().withExif(exif).toBuffer()
}

export const plainJpeg = () => blank().jpeg().toBuffer()
export const plainPng = () => blank().png().toBuffer()
export const plainWebp = () => blank().webp().toBuffer()

const solid = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })

export const jpegOfSize = (width: number, height: number) =>
  solid(width, height).jpeg().toBuffer()
export const pngOfSize = (width: number, height: number) =>
  solid(width, height).png().toBuffer()
export const webpOfSize = (width: number, height: number) =>
  solid(width, height).webp().toBuffer()

export const photoOfSize = (width: number, height: number, exif: ExifSpec) =>
  solid(width, height).jpeg().withExif(exif).toBuffer()

export const transparentPng = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()

export const jpegWithOrientation = (
  width: number,
  height: number,
  orientation: number,
) => solid(width, height).jpeg().withMetadata({ orientation }).toBuffer()

// The left half is red and the right half is blue, so a test can tell whether pixels moved.
export function redBlueJpeg(
  width: number,
  height: number,
  orientation: number,
): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      if (x < width / 2) pixels[at] = 255
      else pixels[at + 2] = 255
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .withMetadata({ orientation })
    .toBuffer()
}
