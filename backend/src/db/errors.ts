// Postgres error code 23505 means "that value already exists".
export function uniqueViolation(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined

  const source = (error as { cause?: unknown }).cause ?? error
  if (typeof source !== 'object' || source === null) return undefined

  const { code, constraint } = source as { code?: string; constraint?: string }
  return code === '23505' ? constraint : undefined
}
