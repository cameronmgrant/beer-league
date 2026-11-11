const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface OriginCheckInput {
  method: string
  origin: string | undefined
  secFetchSite: string | undefined
}

export function isRequestOriginAllowed(
  input: OriginCheckInput,
  allowedOrigins: readonly string[],
): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true

  if (input.origin !== undefined) return allowedOrigins.includes(input.origin)

  if (input.secFetchSite !== undefined) {
    return input.secFetchSite === 'same-origin' || input.secFetchSite === 'none'
  }

  // No browser headers at all: a script or a tool. It cannot be used to act on
  // behalf of someone else's browser, so there is nothing to protect against.
  return true
}
