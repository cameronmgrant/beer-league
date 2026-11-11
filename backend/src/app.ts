import fastifySwagger from '@fastify/swagger'
import Fastify from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import type { Db } from './db/client.js'
import { errorHandler, notFoundHandler } from './errors.js'
import { registerHealthRoute } from './routes/health.js'
import { registerAuth } from './auth/plugin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerProtections, type AuthRateLimit } from './security/plugin.js'

export interface AppOptions {
  db: Db
  logLevel?: string | undefined
  cookieSecure?: boolean | undefined
  allowedOrigins?: string[] | undefined
  trustProxyHops?: number | undefined
  authRateLimit?: AuthRateLimit | undefined
}

export function buildApp({
  db,
  logLevel,
  cookieSecure = false,
  allowedOrigins = [],
  trustProxyHops = 0,
  authRateLimit = { max: 10, windowSeconds: 60 },
}: AppOptions) {
  const app = Fastify({
    logger: logLevel === undefined ? false : { level: logLevel },
    // Trust the first N addresses nearest to this app (the proxies we run behind),
    // and treat the next one as the client. It is a function because Fastify's
    // types do not accept a plain number here.
    trustProxy:
      trustProxyHops > 0
        ? (_address: string, hop: number) => hop < trustProxyHops
        : false,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)

  app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Beer League API', version: '1.0.0' },
    },
    transform: jsonSchemaTransform,
  })

  app.register(
    async (api) => {
      await registerProtections(api, { allowedOrigins })
      await registerAuth(api, db, { cookieSecure })
      api.get('/openapi.json', { schema: { hide: true } }, async () =>
        app.swagger(),
      )
      registerHealthRoute(api, db)
      registerAuthRoutes(api, db, { cookieSecure, authRateLimit })
    },
    { prefix: '/api/v1' },
  )

  return app
}
