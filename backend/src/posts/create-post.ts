import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { beerPosts, dailyCounts } from '../db/schema.js'
import type { TimeSource } from '../resolve-post-time.js'

export interface NewPost {
  userId: number
  imageKey: string
  thumbKey: string
  caption?: string | undefined
  consumedAt: Date
  timeSource: TimeSource
  timeZone: string
  localDate: string
}

export type Post = typeof beerPosts.$inferSelect

export async function createPost(db: Db, post: NewPost): Promise<Post> {
  return db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(beerPosts)
      .values({
        userId: post.userId,
        imageKey: post.imageKey,
        thumbKey: post.thumbKey,
        caption: post.caption ?? null,
        consumedAt: post.consumedAt,
        timeSource: post.timeSource,
        timeZone: post.timeZone,
        localDate: post.localDate,
      })
      .returning()
    if (!saved) throw new Error('Post insert returned no row')

    await tx
      .insert(dailyCounts)
      .values({ userId: post.userId, localDate: post.localDate, count: 1 })
      .onConflictDoUpdate({
        target: [dailyCounts.userId, dailyCounts.localDate],
        set: { count: sql`${dailyCounts.count} + 1` },
      })

    return saved
  })
}
