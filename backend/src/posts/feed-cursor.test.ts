import { describe, expect, it } from 'vitest'
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from './feed-cursor.js'

const make = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')
const good = { c: '2026-01-15T12:00:00.123456Z', i: 42 }

describe('feed cursor', () => {
  it('round-trips', () => {
    const cursor = { createdAt: '2026-01-15T12:00:00.123456Z', id: 42 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('is safe to put in a web address', () => {
    const text = encodeCursor({
      createdAt: '2026-01-15T12:00:00.123456Z',
      id: 42,
    })
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it.each([
    ['an empty string', ''],
    ['text that is not a cursor', 'not a cursor'],
    ['JSON that is not an object', make(null)],
    ['an array', make([])],
    ['an empty object', make({})],
    ['a missing id', make({ c: good.c })],
    ['a missing time', make({ i: 42 })],
    ['an id that is text', make({ c: good.c, i: '42' })],
    ['an id of zero', make({ ...good, i: 0 })],
    ['a negative id', make({ ...good, i: -5 })],
    ['a fractional id', make({ ...good, i: 1.5 })],
    ['an id too large to be exact', make({ ...good, i: 1e21 })],
    [
      'a time with only milliseconds',
      make({ ...good, c: '2026-01-15T12:00:00.123Z' }),
    ],
    [
      'a time without the Z',
      make({ ...good, c: '2026-01-15T12:00:00.123456' }),
    ],
    [
      'a date that does not exist',
      make({ ...good, c: '2026-13-45T00:00:00.000000Z' }),
    ],
  ])('rejects %s', (_name, text) => {
    expect(() => decodeCursor(text)).toThrow(InvalidCursorError)
  })
})
