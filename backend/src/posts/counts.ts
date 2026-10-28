import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { dailyCounts, users } from '../db/schema.js'
import { periodRange, type Period } from './period-range.js'
import { assignRanks } from './ranks.js'

export interface UserCounts {
  day: number
  month: number
  year: number
}

export interface LeaderboardRow {
  userId: number
  username: string
  count: number
  rank: number
}

async function totalFor(
  db: Db,
  userId: number,
  period: Period,
  anchor: string,
): Promise<number> {
  const { from, to } = periodRange(period, anchor)
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${dailyCounts.count}), 0)::int` })
    .from(dailyCounts)
    .where(
      and(
        eq(dailyCounts.userId, userId),
        gte(dailyCounts.localDate, from),
        lt(dailyCounts.localDate, to),
      ),
    )
  return row?.total ?? 0
}

export async function getUserCounts(
  db: Db,
  userId: number,
  today: string,
): Promise<UserCounts> {
  const [day, month, year] = await Promise.all([
    totalFor(db, userId, 'day', today),
    totalFor(db, userId, 'month', today),
    totalFor(db, userId, 'year', today),
  ])
  return { day, month, year }
}

export async function getLeaderboard(
  db: Db,
  period: Period,
  anchor: string,
): Promise<LeaderboardRow[]> {
  const { from, to } = periodRange(period, anchor)
  const total = sql<number>`coalesce(sum(${dailyCounts.count}), 0)::int`

  const rows = await db
    .select({ userId: users.id, username: users.username, count: total })
    .from(users)
    .leftJoin(
      dailyCounts,
      and(
        eq(dailyCounts.userId, users.id),
        gte(dailyCounts.localDate, from),
        lt(dailyCounts.localDate, to),
      ),
    )
    .groupBy(users.id, users.username)
    .orderBy(desc(total), asc(users.username))

  return assignRanks(rows)
}
