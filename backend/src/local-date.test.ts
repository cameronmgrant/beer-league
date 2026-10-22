import { describe, it, expect } from 'vitest'
import { getLocalDate } from './local-date.js'

describe('getLocalDate', () => {
  it.each([
    [
      'afternoon post',
      '2026-01-15T18:00:00Z',
      'America/New_York',
      '2026-01-15',
    ],
    [
      '5:00 am starts a new day',
      '2026-01-15T10:00:00Z',
      'America/New_York',
      '2026-01-15',
    ],
    [
      '4:59 am still counts as yesterday',
      '2026-01-15T09:59:00Z',
      'America/New_York',
      '2026-01-14',
    ],
    [
      '11:50 pm still counts for that day',
      '2026-01-16T04:50:00Z',
      'America/New_York',
      '2026-01-15',
    ],
    [
      '12:01 am is the same day as 11:59 pm',
      '2026-01-16T05:01:00Z',
      'America/New_York',
      '2026-01-15',
    ],
    ['year rollover', '2026-01-01T07:00:00Z', 'America/New_York', '2025-12-31'],
    [
      'month rollover',
      '2026-02-01T08:00:00Z',
      'America/New_York',
      '2026-01-31',
    ],
    ['leap day', '2028-03-01T08:00:00Z', 'America/New_York', '2028-02-29'],
    [
      'same instant, Los Angeles',
      '2026-01-15T10:00:00Z',
      'America/Los_Angeles',
      '2026-01-14',
    ],
    ['same instant, Tokyo', '2026-01-15T10:00:00Z', 'Asia/Tokyo', '2026-01-15'],
    [
      'half-hour zone, just before 5 am',
      '2026-01-15T23:29:00Z',
      'Asia/Kolkata',
      '2026-01-15',
    ],
    [
      'half-hour zone, at 5 am',
      '2026-01-15T23:30:00Z',
      'Asia/Kolkata',
      '2026-01-16',
    ],
    [
      'spring forward, before 5 am',
      '2026-03-08T08:59:00Z',
      'America/New_York',
      '2026-03-07',
    ],
    [
      'spring forward, at 5 am',
      '2026-03-08T09:00:00Z',
      'America/New_York',
      '2026-03-08',
    ],
    [
      'fall back, before 5 am',
      '2026-11-01T09:59:00Z',
      'America/New_York',
      '2026-10-31',
    ],
    [
      'fall back, at 5 am',
      '2026-11-01T10:00:00Z',
      'America/New_York',
      '2026-11-01',
    ],
    [
      'fall back, first 1:30 am',
      '2026-11-01T05:30:00Z',
      'America/New_York',
      '2026-10-31',
    ],
    [
      'fall back, second 1:30 am',
      '2026-11-01T06:30:00Z',
      'America/New_York',
      '2026-10-31',
    ],
  ])('%s', (_nname, iso, zone, expected) => {
    expect(getLocalDate(new Date(iso), zone)).toBe(expected)
  })
  it('throws for an invalid time zone', () => {
    expect(() =>
      getLocalDate(new Date('2026-01-15T18:00:00Z'), 'Not/AZone'),
    ).toThrow()
  })

  it('throws for an invalid date', () => {
    expect(() => getLocalDate(new Date('nope'), 'America/New_York')).toThrow()
  })
})
