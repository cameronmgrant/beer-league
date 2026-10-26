import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timeZone: text('time_zone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdBy: bigint('created_by', { mode: 'number' }).references(
    () => users.id,
  ),
  usedBy: bigint('used_by', { mode: 'number' }).references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const beerPosts = pgTable(
  'beer_posts',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    imageKey: text('image_key').notNull(),
    thumbKey: text('thumb_key').notNull(),
    caption: text('caption'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull(),
    timeSource: text('time_source').notNull(),
    timeZone: text('time_zone').notNull(),
    localDate: date('local_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('caption_length', sql`char_length(${t.caption}) <= 140`),
    check('time_source_valid', sql`${t.timeSource} IN ('exif', 'manual')`),
    index('beer_posts_feed_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.deletedAt} IS NULL`),
    index('beer_posts_user_date_idx').on(t.userId, t.localDate),
  ],
)

export const dailyCounts = pgTable(
  'daily_counts',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    localDate: date('local_date').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate] }),
    check('count_non_negative', sql`${t.count} >= 0`),
  ],
)
