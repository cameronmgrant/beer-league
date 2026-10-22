import { DateTime } from 'luxon'

const DAY_STARTS_AT_HOUR = 5

export function getLocalDate(consumedAt: Date, timeZone: string): string {
  const local = DateTime.fromJSDate(consumedAt, { zone: timeZone })

  if (!local.isValid) {
    throw new Error('Cannot compute local date: ${local.invalidExplanation}')
  }

  const countingDay =
    local.hour < DAY_STARTS_AT_HOUR ? local.minus({ days: 1 }) : local
  return countingDay.toISODate()
}
