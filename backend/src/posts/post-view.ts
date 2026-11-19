import { z } from 'zod/v4'
import type { Post } from './create-post.js'

export const postViewSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  caption: z.string().nullable(),
  consumedAt: z.string(),
  localDate: z.string(),
  timeZone: z.string(),
  timeSource: z.enum(['exif', 'manual']),
  imageUrl: z.string(),
  thumbUrl: z.string(),
  createdAt: z.string(),
})

export type PostView = z.infer<typeof postViewSchema>

export function photoUrl(key: string): string {
  return `/api/v1/${key}`
}

export function toPostView(post: Post, username: string): PostView {
  if (post.timeSource !== 'exif' && post.timeSource !== 'manual') {
    throw new Error(
      `Post ${post.id} has an unknown time source: ${post.timeSource}`,
    )
  }

  return {
    id: post.id,
    username,
    caption: post.caption,
    consumedAt: post.consumedAt.toISOString(),
    localDate: post.localDate,
    timeZone: post.timeZone,
    timeSource: post.timeSource,
    imageUrl: photoUrl(post.imageKey),
    thumbUrl: photoUrl(post.thumbKey),
    createdAt: post.createdAt.toISOString(),
  }
}
