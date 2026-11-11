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

export interface AppOptions {
  db: Db
  logLevel?: string | undefined
  cookieSecure?: boolean | undefined
}

export function buildApp({ db, logLevel, cookieSecure = false }: AppOptions) {
  const app = Fastify({
    logger: logLevel === undefined ? false : { level: logLevel },
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
      await registerAuth(api, db, { cookieSecure })
      api.get('/openapi.json', { schema: { hide: true } }, async () =>
        app.swagger(),
      )
      registerHealthRoute(api, db)
      registerAuthRoutes(api, db, { cookieSecure })
    },
    { prefix: '/api/v1' },
  )

  return app
}
