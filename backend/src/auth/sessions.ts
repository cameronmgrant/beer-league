import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, lte } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
export const SESSION_EXTEND_AFTER_MS = 24 * 60 * 60 * 1000

export interface SessionUser {
  id: number
  username: string
  timeZone: string
}

export interface ActiveSession {
  user: SessionUser
  expiresAt: Date
  extended: boolean
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)
  await db
    .insert(sessions)
    .values({ tokenHash: hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

export async function findSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<ActiveSession | undefined> {
  const tokenHash = hashToken(token)
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      timeZone: users.timeZone,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))

  if (!row) return undefined

  const user = { id: row.id, username: row.username, timeZone: row.timeZone }
  const timeLeft = row.expiresAt.getTime() - now.getTime()
  if (timeLeft >= SESSION_LIFETIME_MS - SESSION_EXTEND_AFTER_MS) {
    return { user, expiresAt: row.expiresAt, extended: false }
  }

  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)
  await db
    .update(sessions)
    .set({ expiresAt })
    .where(eq(sessions.tokenHash, tokenHash))
  return { user, expiresAt, extended: true }
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function deleteExpiredSessions(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ tokenHash: sessions.tokenHash })
  return removed.length
}
