import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { uniqueViolation } from '../db/errors.js'
import { invites, users } from '../db/schema.js'
import { assertValidTimeZone } from '../time-zone.js'
import { hashPassword } from './password.js'
import type { SessionUser } from './sessions.js'

export interface RegisterInput {
  username: string // already trimmed and lowercased by the caller
  password: string
  timeZone: string
  inviteCode: string
  ageConfirmed: true // the caller must have checked the box before calling
}

export type RegisterResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid_invite' | 'username_taken' }

export async function registerUser(
  db: Db,
  input: RegisterInput,
  now: Date = new Date(),
): Promise<RegisterResult> {
  assertValidTimeZone(input.timeZone)

  // Hashing is slow on purpose, so it happens before the transaction starts,
  // and never while database locks are held.
  const passwordHash = await hashPassword(input.password)

  try {
    return await db.transaction(async (tx): Promise<RegisterResult> => {
      const claimed = await tx
        .update(invites)
        .set({ usedAt: now })
        .where(
          and(
            eq(invites.code, input.inviteCode),
            isNull(invites.usedAt),
            gt(invites.expiresAt, now),
          ),
        )
        .returning({ code: invites.code })
      if (claimed.length === 0) return { ok: false, reason: 'invalid_invite' }

      const [user] = await tx
        .insert(users)
        .values({
          username: input.username,
          passwordHash,
          timeZone: input.timeZone,
          ageConfirmedAt: now,
        })
        .returning({
          id: users.id,
          username: users.username,
          timeZone: users.timeZone,
        })
      if (!user) throw new Error('User insert returned no row')

      await tx
        .update(invites)
        .set({ usedBy: user.id })
        .where(eq(invites.code, input.inviteCode))
      return { ok: true, user }
    })
  } catch (error) {
    // The transaction was rolled back, so the invite has not been used up.
    if (uniqueViolation(error) === 'users_username_unique') {
      return { ok: false, reason: 'username_taken' }
    }
    throw error
  }
}
