import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { beerPosts, dailyCounts } from '../db/schema.js'
import type { Post } from './create-post.js'

export interface DeletePostInput {
  postId: number
  userId: number
}

export type DeleteResult =
  { ok: true; post: Post } | { ok: false; reason: 'not_found' | 'forbidden' }

export async function deletePost(
  db: Db,
  input: DeletePostInput,
): Promise<DeleteResult> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(beerPosts)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(beerPosts.id, input.postId),
          eq(beerPosts.userId, input.userId),
          isNull(beerPosts.deletedAt),
        ),
      )
      .returning()

    if (deleted) {
      const counted = await tx
        .update(dailyCounts)
        .set({ count: sql`${dailyCounts.count} - 1` })
        .where(
          and(
            eq(dailyCounts.userId, deleted.userId),
            eq(dailyCounts.localDate, deleted.localDate),
          ),
        )
        .returning({ count: dailyCounts.count })

      if (counted.length === 0) {
        throw new Error(
          `Cannot delete post ${deleted.id}: the daily count row is missing`,
        )
      }
      return { ok: true, post: deleted }
    }

    const [existing] = await tx
      .select({ userId: beerPosts.userId })
      .from(beerPosts)
      .where(eq(beerPosts.id, input.postId))

    if (existing && existing.userId !== input.userId) {
      return { ok: false, reason: 'forbidden' }
    }
    return { ok: false, reason: 'not_found' }
  })
}
