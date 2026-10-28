import { describe, expect, it } from 'vitest'
import { periodRange, type Period } from './period-range.js'

describe('periodRange', () => {
  it.each<[string, Period, string, string, string]>([
    ['a day', 'day', '2026-01-15', '2026-01-15', '2026-01-16'],
    [
      'the last day of a month',
      'day',
      '2026-01-31',
      '2026-01-31',
      '2026-02-01',
    ],
    ['a month', 'month', '2026-01-15', '2026-01-01', '2026-02-01'],
    [
      'the first day of a month',
      'month',
      '2026-01-01',
      '2026-01-01',
      '2026-02-01',
    ],
    [
      'December, which ends the year',
      'month',
      '2026-12-31',
      '2026-12-01',
      '2027-01-01',
    ],
    ['a year', 'year', '2026-06-15', '2026-01-01', '2027-01-01'],
    ['a leap day as a day', 'day', '2028-02-29', '2028-02-29', '2028-03-01'],
    [
      'a leap day as a month',
      'month',
      '2028-02-29',
      '2028-02-01',
      '2028-03-01',
    ],
  ])('covers %s', (_name, period, anchor, from, to) => {
    expect(periodRange(period, anchor)).toEqual({ from, to })
  })

  it.each(['2026-02-30', 'nope', '2026-1-5', '2026-01-15T10:00:00Z', ''])(
    'rejects the invalid date "%s"',
    (anchor) => {
      expect(() => periodRange('day', anchor)).toThrow('Invalid date')
    },
  )
})
