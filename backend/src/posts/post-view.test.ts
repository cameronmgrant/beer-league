import { describe, expect, it } from 'vitest'
import type { Post } from './create-post.js'
import { photoUrl, postViewSchema, toPostView } from './post-view.js'

const post: Post = {
  id: 7,
  userId: 3,
  imageKey: 'photos/0123456789abcdef0123456789abcdef.jpg',
  thumbKey: 'photos/0123456789abcdef0123456789abcdef-thumb.jpg',
  caption: 'Cold one',
  consumedAt: new Date('2026-01-15T00:42:10Z'),
  timeSource: 'exif',
  timeZone: 'Asia/Tokyo',
  localDate: '2026-01-15',
  createdAt: new Date('2026-01-15T12:00:00.500Z'),
  deletedAt: null,
}

describe('photoUrl', () => {
  it('turns a storage key into a web address under the API', () => {
    expect(photoUrl('photos/abc.jpg')).toBe('/api/v1/photos/abc.jpg')
  })
})

describe('toPostView', () => {
  it('shows a post with text dates and web addresses for its pictures', () => {
    expect(toPostView(post, 'alice')).toEqual({
      id: 7,
      username: 'alice',
      caption: 'Cold one',
      consumedAt: '2026-01-15T00:42:10.000Z',
      localDate: '2026-01-15',
      timeZone: 'Asia/Tokyo',
      timeSource: 'exif',
      imageUrl: '/api/v1/photos/0123456789abcdef0123456789abcdef.jpg',
      thumbUrl: '/api/v1/photos/0123456789abcdef0123456789abcdef-thumb.jpg',
      createdAt: '2026-01-15T12:00:00.500Z',
    })
  })

  it('keeps a missing caption as null', () => {
    expect(toPostView({ ...post, caption: null }, 'alice').caption).toBeNull()
  })

  it('never shows storage keys, the owner id, or the deletion time', () => {
    const view = toPostView(post, 'alice')

    expect(Object.keys(view).sort()).toEqual([
      'caption',
      'consumedAt',
      'createdAt',
      'id',
      'imageUrl',
      'localDate',
      'thumbUrl',
      'timeSource',
      'timeZone',
      'username',
    ])
    expect(JSON.stringify(view)).not.toContain('imageKey')
  })

  it('matches the published schema', () => {
    expect(postViewSchema.safeParse(toPostView(post, 'alice')).success).toBe(
      true,
    )
  })

  it('refuses a stored post with an unknown time source instead of passing it on', () => {
    expect(() =>
      toPostView({ ...post, timeSource: 'upload' }, 'alice'),
    ).toThrow('time source')
  })
})
