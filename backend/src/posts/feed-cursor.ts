import { DateTime } from 'luxon'

export interface FeedCursor {
  createdAt: string // exact time with six fractional digits, e.g. 2026-01-15T12:00:00.123456Z
  id: number
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt, i: cursor.id }),
  ).toString('base64url')
}

export function decodeCursor(text: string): FeedCursor {
  let data: unknown
  try {
    data = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidCursorError()
  }
  if (typeof data !== 'object' || data === null) throw new InvalidCursorError()

  const { c, i } = data as { c?: unknown; i?: unknown }
  if (typeof c !== 'string' || !TIMESTAMP.test(c))
    throw new InvalidCursorError()
  if (!DateTime.fromISO(`${c.slice(0, 19)}Z`, { zone: 'utc' }).isValid) {
    throw new InvalidCursorError()
  }
  if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 1)
    throw new InvalidCursorError()

  return { createdAt: c, id: i }
}
