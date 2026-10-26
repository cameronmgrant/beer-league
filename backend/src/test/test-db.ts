import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { createDb, type Db } from '../db/client.js'

export function createTestDb() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set (copy backend/.env.example to backend/.env)',
    )
  }
  return createDb(url)
}

export async function resetTables(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE daily_counts, beer_posts, invites, users RESTART IDENTITY CASCADE`,
  )
}
