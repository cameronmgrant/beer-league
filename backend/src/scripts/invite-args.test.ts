import { describe, expect, it } from 'vitest'
import { parseInviteArgs } from './invite-args.js'

describe('parseInviteArgs', () => {
  it('creates one invite valid for 14 days when nothing is said', () => {
    expect(parseInviteArgs([])).toEqual({ count: 1, days: 14 })
  })

  it('reads the count and the days', () => {
    expect(parseInviteArgs(['--count', '5', '--days', '30'])).toEqual({
      count: 5,
      days: 30,
    })
  })

  it('reads one option on its own', () => {
    expect(parseInviteArgs(['--count', '3'])).toEqual({ count: 3, days: 14 })
    expect(parseInviteArgs(['--days', '7'])).toEqual({ count: 1, days: 7 })
  })

  it('passes text that is not a number on as NaN, for the invite rules to refuse', () => {
    expect(Number.isNaN(parseInviteArgs(['--count', 'lots']).count)).toBe(true)
  })

  it.each([
    ['an option it does not know', ['--colour', 'red']],
    ['a loose word', ['five']],
    ['an option with no value', ['--count']],
  ])('refuses %s', (_name, args) => {
    expect(() => parseInviteArgs(args)).toThrow()
  })
})
