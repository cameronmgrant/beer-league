import { z } from 'zod/v4'

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
})

export interface Config {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  host: string
  databaseUrl: string
  logLevel: string
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
  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    host: values.HOST,
    databaseUrl: values.DATABASE_URL,
    logLevel: values.LOG_LEVEL,
  }
}
