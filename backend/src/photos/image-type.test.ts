import { describe, expect, it } from 'vitest'
import { detectImageType } from './image-type.js'
import { plainJpeg, plainPng, plainWebp } from '../test/photos.js'

const bytes = (...values: number[]) => Uint8Array.from(values)
const text = (value: string) => new Uint8Array(Buffer.from(value, 'latin1'))

// An ISO "ftyp" box: four size bytes, "ftyp", then the brand.
function ftyp(brand: string): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from(`ftyp${brand}`, 'latin1'),
      Buffer.alloc(12),
    ]),
  )
}

describe('detectImageType: real files', () => {
  it.each([
    ['a JPEG', plainJpeg, 'jpeg'],
    ['a PNG', plainPng, 'png'],
    ['a WebP', plainWebp, 'webp'],
  ])('recognizes %s', async (_name, make, expected) => {
    expect(detectImageType(await make())).toBe(expected)
  })
})

describe('detectImageType: headers', () => {
  it.each([
    ['a JPEG start', bytes(0xff, 0xd8, 0xff, 0xe0), 'jpeg'],
    [
      'a PNG start',
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      'png',
    ],
    ['a WebP start', text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), 'webp'],
    ['a HEIC photo', ftyp('heic'), 'heic'],
    ['a HEIC photo from another encoder', ftyp('heix'), 'heic'],
    ['a HEIF image sequence', ftyp('msf1'), 'heic'],
    ['a general HEIF image', ftyp('mif1'), 'heic'],
  ])('recognizes %s', (_name, input, expected) => {
    expect(detectImageType(input)).toBe(expected)
  })

  it.each([
    ['nothing', new Uint8Array()],
    ['one byte', bytes(0xff)],
    ['two bytes of a JPEG start', bytes(0xff, 0xd8)],
    [
      'seven bytes of a PNG start',
      bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a),
    ],
    [
      'a RIFF file that is not WebP',
      text('RIFF\u0000\u0000\u0000\u0000WAVEfmt '),
    ],
    ['a lowercase "webp"', text('RIFF\u0000\u0000\u0000\u0000webpVP8 ')],
    ['a GIF', text('GIF89a\u0001\u0000\u0001\u0000')],
    ['an SVG', text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['an SVG with a script', text('<svg onload="alert(1)"></svg>')],
    ['a PDF', text('%PDF-1.7')],
    ['an AVIF image', ftyp('avif')],
    ['an ISO file of another kind', ftyp('mp42')],
    ['plain text', text('hello, I am not a photo')],
    ['a TIFF', bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00)],
  ])('does not recognize %s', (_name, input) => {
    expect(detectImageType(input)).toBe('unknown')
  })
})
