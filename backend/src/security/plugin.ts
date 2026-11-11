import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import { AppError } from '../errors.js'
import { isRequestOriginAllowed } from './csrf.js'

export interface AuthRateLimit {
  max: number
  windowSeconds: number
}

// The per-route setting for the endpoints people could use to guess credentials.
// Each route that uses it keeps its own count for each client address.
export function authRouteLimit(limit: AuthRateLimit) {
  return {
    rateLimit: { max: limit.max, timeWindow: limit.windowSeconds * 1000 },
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export async function registerProtections(
  api: FastifyInstance,
  options: { allowedOrigins: string[] },
): Promise<void> {
  await api.register(rateLimit, {
    global: false, // only routes that ask for a limit get one
    errorResponseBuilder: () =>
      new AppError(
        429,
        'rate_limited',
        'Too many attempts. Please wait a moment and try again.',
      ),
  })

  api.addHook('onRequest', async (request) => {
    const allowed = isRequestOriginAllowed(
      {
        method: request.method,
        origin: firstHeader(request.headers.origin),
        secFetchSite: firstHeader(request.headers['sec-fetch-site']),
      },
      options.allowedOrigins,
    )
    if (!allowed) {
      throw new AppError(
        403,
        'forbidden_origin',
        'This request came from an origin that is not allowed',
      )
    }
  })
}
