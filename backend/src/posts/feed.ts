import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { beerPosts, users } from '../db/schema.js'
import type { Post } from './create-post.js'
import { decodeCursor, encodeCursor } from './feed-cursor.js'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export type FeedPost = Post & { username: string }

export interface FeedOptions {
  limit?: number | undefined
  cursor?: string | undefined
}

export interface FeedPage {
  posts: FeedPost[]
  nextCursor: string | null
}

export async function getFeed(
  db: Db,
  options: FeedOptions = {},
): Promise<FeedPage> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new RangeError(
      `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
    )
  }
  const cursor =
    options.cursor === undefined ? undefined : decodeCursor(options.cursor)

  // The upload time as text, keeping all six fractional digits that a Date would lose.
  const exactTime = sql<string>`to_char(${beerPosts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

  const rows = await db
    .select({ post: beerPosts, username: users.username, exactTime })
    .from(beerPosts)
    .innerJoin(users, eq(users.id, beerPosts.userId))
    .where(
      and(
        isNull(beerPosts.deletedAt),
        cursor
          ? sql`(${beerPosts.createdAt}, ${beerPosts.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(beerPosts.createdAt), desc(beerPosts.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const hasMore = rows.length > limit

  return {
    posts: page.map((row) => ({ ...row.post, username: row.username })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.exactTime, id: last.post.id })
        : null,
  }
}
