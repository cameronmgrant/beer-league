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
