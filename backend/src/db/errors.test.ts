import { describe, expect, it } from 'vitest'
import { uniqueViolation } from './errors.js'

describe('uniqueViolation', () => {
  it('returns the name of the constraint that was broken', () => {
    expect(
      uniqueViolation({ code: '23505', constraint: 'users_username_unique' }),
    ).toBe('users_username_unique')
  })

  it('looks inside a wrapped error', () => {
    const wrapped = {
      message: 'Failed query',
      cause: { code: '23505', constraint: 'some_rule' },
    }
    expect(uniqueViolation(wrapped)).toBe('some_rule')
  })

  it.each([
    ['a different database error', { code: '23503', constraint: 'some_rule' }],
    ['an object with no code', {}],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('returns undefined for %s', (_name, error) => {
    expect(uniqueViolation(error)).toBeUndefined()
  })
})
