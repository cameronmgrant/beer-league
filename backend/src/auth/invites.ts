import { randomInt } from 'node:crypto'
import type { Db } from '../db/client.js'
import { invites } from '../db/schema.js'

// No i, l, o, 0 or 1, which are easy to misread when a code is typed from a message.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const DAY_MS = 24 * 60 * 60 * 1000

export interface CreateInvitesInput {
  count: number
  days: number
}

export function generateInviteCode(): string {
  const group = () =>
    Array.from({ length: 4 }, () =>
      ALPHABET.charAt(randomInt(ALPHABET.length)),
    ).join('')
  return [group(), group(), group()].join('-')
}

export async function createInvites(
  db: Db,
  input: CreateInvitesInput,
  now: Date = new Date(),
): Promise<Array<{ code: string; expiresAt: Date }>> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
    throw new RangeError('count must be a whole number from 1 to 100')
  }
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) {
    throw new RangeError('days must be a whole number from 1 to 90')
  }

  const expiresAt = new Date(now.getTime() + input.days * DAY_MS)
  const codes = new Set<string>()
  while (codes.size < input.count) codes.add(generateInviteCode())

  const rows = [...codes].map((code) => ({ code, expiresAt }))
  await db.insert(invites).values(rows)
  return rows
}
