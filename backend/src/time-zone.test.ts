import { describe, it, expect } from 'vitest'
import { assertValidTimeZone, timeZoneFromCoordinates } from './time-zone.js'

describe('timeZoneFromCoordinates', () => {
  it.each([
    ['New York', 40.7128, -74.006, 'America/New_York'],
    ['Tokyo', 35.6762, 139.6503, 'Asia/Tokyo'],
    ['London', 51.5074, -0.1278, 'Europe/London'],
    ['Kolkata', 22.5726, 88.3639, 'Asia/Kolkata'],
    ['Exactly 0,0', 0, 0, undefined],
    ['Latitude 91', 91, -0.1278, undefined],
  ])('maps %s to its zone', (_name, lat, lon, expected) => {
    expect(timeZoneFromCoordinates(lat, lon)).toBe(expected)
  })
  it('does not throw', () => {
    expect(() => assertValidTimeZone('America/New_York'))
  })
  it('throws', () => {
    expect(() => assertValidTimeZone('Not/AZone')).toThrow()
  })
  it('throws', () => {
    expect(() => assertValidTimeZone('')).toThrow()
  })
})
