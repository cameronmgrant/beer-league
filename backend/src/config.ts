import { z } from 'zod/v4'

const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']

// An origin is exactly scheme://host[:port], in lowercase, with no path.
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    )
  } catch {
    return false
  }
}

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
  .pipe(
    z
      .array(
        z
          .string()
          .refine(isOrigin, 'must be an origin such as https://example.com'),
      )
      .min(1, 'must list at least one origin'),
  )

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  ALLOWED_ORIGINS: originList.optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(10),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .default(60),
})

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: string
  databaseUrl: string
  logLevel: string
  allowedOrigins: string[]
  trustProxyHops: number
  authRateLimit: { max: number; windowSeconds: number }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }

  const values = parsed.data
  const production = values.NODE_ENV === 'production'
  if (production && values.ALLOWED_ORIGINS === undefined) {
    throw new Error(
      'Invalid configuration: ALLOWED_ORIGINS: required when NODE_ENV is production',
    )
  }

  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    host: values.HOST,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
    allowedOrigins: values.ALLOWED_ORIGINS ?? DEV_ORIGINS,
    trustProxyHops: values.TRUST_PROXY_HOPS,
    authRateLimit: {
      max: values.AUTH_RATE_LIMIT_MAX,
      windowSeconds: values.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    },
  }
}
