import { DateTime } from 'luxon'

export type Period = 'day' | 'month' | 'year'

export interface DateRange {
  from: string
  to: string
}

const STEP = {
  day: { days: 1 },
  month: { months: 1 },
  year: { years: 1 },
} as const

export function periodRange(period: Period, anchor: string): DateRange {
  const date = DateTime.fromISO(anchor, { zone: 'utc' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !date.isValid) {
    throw new Error(`Invalid date: "${anchor}"`)
  }

  const start = date.startOf(period)
  const end = start.plus(STEP[period])
  return { from: start.toISODate(), to: end.toISODate() }
}
