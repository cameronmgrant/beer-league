import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

const password = 'correct horse battery'

describe('password hashing', () => {
  it('produces an argon2id hash that does not contain the password', async () => {
    const hash = await hashPassword(password)

    expect(hash).toMatch(/^\$argon2id\$/)
    expect(hash).not.toContain(password)
  })

  it('uses a different salt every time', async () => {
    expect(await hashPassword(password)).not.toBe(await hashPassword(password))
  })

  it('accepts the right password', async () => {
    expect(await verifyPassword(await hashPassword(password), password)).toBe(
      true,
    )
  })

  it.each([
    'wrong',
    '',
    'correct horse battery stapl',
    'CORRECT HORSE BATTERY',
    ' correct horse battery',
  ])('rejects the password "%s"', async (attempt) => {
    expect(await verifyPassword(await hashPassword(password), attempt)).toBe(
      false,
    )
  })

  it.each([
    ['a 128 character password', 'x'.repeat(128)],
    ['spaces and symbols', 'p@ss w0rd with spaces & symbols!'],
    ['emoji and accents', 'caf\u00e9 \u{1F37A} \u00fcber'],
  ])('works with %s', async (_name, unusual) => {
    const hash = await hashPassword(unusual)
    expect(await verifyPassword(hash, unusual)).toBe(true)
    expect(await verifyPassword(hash, `${unusual}!`)).toBe(false)
  })

  it.each([
    '',
    'not a hash',
    '$argon2id$garbage',
    '$argon2id$v=19$m=1,t=1,p=1$bad$bad',
  ])(
    'treats the malformed hash "%s" as a failed login instead of crashing',
    async (badHash) => {
      expect(await verifyPassword(badHash, password)).toBe(false)
    },
  )
})
