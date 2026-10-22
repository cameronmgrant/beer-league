import tzlookup from 'tz-lookup'
import { IANAZone } from 'luxon'

export function assertValidTimeZone(zone: string): void {
  if (!IANAZone.isValidZone(zone)) {
    throw new Error('Ivalid time zone: "${zone}"')
  }
}
export function timeZoneFromCoordinates(
  latitude: number,
  longitude: number,
): string | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return undefined
  if (latitude === 0 && longitude === 0) return undefined

  try {
    const zone = tzlookup(latitude, longitude)
    return IANAZone.isValidZone(zone) ? zone : undefined
  } catch {
    return undefined
  }
}
