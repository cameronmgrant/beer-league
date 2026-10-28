import { isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { beerPosts, dailyCounts } from '../db/schema.js'

export interface Discrepancy {
  userId: number
  localDate: string
  stored: number
  actual: number
}

export async function reconcileCounts(db: Db): Promise<Discrepancy[]> {
  return db.transaction(
    async (tx) => {
      const actualRows = await tx
        .select({
          userId: beerPosts.userId,
          localDate: beerPosts.localDate,
          actual: sql<number>`count(*)::int`,
        })
        .from(beerPosts)
        .where(isNull(beerPosts.deletedAt))
        .groupBy(beerPosts.userId, beerPosts.localDate)

      const storedRows = await tx.select().from(dailyCounts)

      // One line per user and day, with a column for each side.
      const sheet = new Map<string, Discrepancy>()
      const line = (userId: number, localDate: string): Discrepancy => {
        const key = `${userId}|${localDate}`
        let entry = sheet.get(key)
        if (!entry) {
          entry = { userId, localDate, stored: 0, actual: 0 }
          sheet.set(key, entry)
        }
        return entry
      }

      for (const row of actualRows)
        line(row.userId, row.localDate).actual = row.actual
      for (const row of storedRows)
        line(row.userId, row.localDate).stored = row.count

      return [...sheet.values()]
        .filter((entry) => entry.stored !== entry.actual)
        .sort(
          (a, b) =>
            a.userId - b.userId || a.localDate.localeCompare(b.localDate),
        )
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
