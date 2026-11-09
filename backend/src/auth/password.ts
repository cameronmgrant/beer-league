import * as argon2 from 'argon2'

// argon2id at the OWASP minimum settings: 19 MiB of memory, 2 passes, 1 lane.
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS)
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false // a broken hash must neither let anyone in nor crash the request
  }
}
