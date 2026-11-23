import fastifyMultipart from '@fastify/multipart'
import fastifySwagger from '@fastify/swagger'
import helmet from '@fastify/helmet'
import Fastify from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { registerAuth } from './auth/plugin.js'
import type { Db } from './db/client.js'
import { errorHandler, notFoundHandler } from './errors.js'
import { MAX_PIXELS, MAX_UPLOAD_BYTES } from './photos/process.js'
import type { PhotoStorage } from './photos/storage.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerBeersRoutes } from './routes/beers.js'
import { registerHealthRoute } from './routes/health.js'
import { registerProtections, type AuthRateLimit } from './security/plugin.js'
import { registerFeedRoute } from './routes/feed.js'
import { registerPhotoRoutes } from './routes/photos.js'
import { registerStatsRoutes } from './routes/stats.js'

// The largest JSON this API ever reads is a sign-up form. Uploads are streamed and have their own limit.
const JSON_BODY_LIMIT_BYTES = 64 * 1024
// Time allowed for a whole request to arrive. A 5 MB photo on a weak connection can take over a minute.
const REQUEST_TIMEOUT_MS = 120_000

export interface AppOptions {
  db: Db
  storage: PhotoStorage
  logLevel?: string | undefined
  cookieSecure?: boolean | undefined
  allowedOrigins?: string[] | undefined
  trustProxyHops?: number | undefined
  authRateLimit?: AuthRateLimit | undefined
  uploadRateLimit?: AuthRateLimit | undefined
  now?: (() => Date) | undefined
  logStream?: { write(message: string): void } | undefined
  photoLimits?:
    | { maxBytes?: number | undefined; maxPixels?: number | undefined }
    | undefined
}

export function buildApp({
  db,
  storage,
  logLevel,
  logStream,
  cookieSecure = false,
  allowedOrigins = [],
  trustProxyHops = 0,
  authRateLimit = { max: 10, windowSeconds: 60 },
  uploadRateLimit = { max: 20, windowSeconds: 600 },
  photoLimits = {},
  now = () => new Date(),
}: AppOptions) {
  const maxBytes = photoLimits.maxBytes ?? MAX_UPLOAD_BYTES
  const maxPixels = photoLimits.maxPixels ?? MAX_PIXELS

  const app = Fastify({
    logger:
      logLevel === undefined
        ? false
        : {
            level: logLevel,
            // The default request log has no headers; this guards against that ever changing.
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            ...(logStream === undefined ? {} : { stream: logStream }),
          },
    // Trust the first N addresses nearest to this app (the proxies we run behind),
    // and treat the next one as the client. It is a function because Fastify's
    // types do not accept a plain number here.
    trustProxy:
      trustProxyHops > 0
        ? (_address: string, hop: number) => hop < trustProxyHops
        : false,
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
  })
  // Only JSON and form uploads are ever accepted. Fastify also parses text/plain by default,
  // one of the three body types a web page can send to another site with no preflight check.
  app.removeContentTypeParser('text/plain')
  app.register(helmet, {
    // This is a JSON API: it never needs to load or embed anything.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // Only meaningful (and only safe to send) when the site really is served over HTTPS.
    hsts: cookieSecure ? { maxAge: 15_552_000 } : false,
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
      await api.register(fastifyMultipart, {
        limits: {
          fileSize: maxBytes,
          files: 1,
          fields: 5,
          fieldSize: 2048,
          parts: 6,
        },
      })
      api.get('/openapi.json', { schema: { hide: true } }, async () =>
        app.swagger(),
      )
      registerHealthRoute(api, db)
      registerAuthRoutes(api, db, { cookieSecure, authRateLimit })
      registerBeersRoutes(api, db, {
        storage,
        uploadRateLimit,
        limits: { maxBytes, maxPixels },
      })
      registerPhotoRoutes(api, { storage })
      registerFeedRoute(api, db)
      registerStatsRoutes(api, db, { now })
    },
    { prefix: '/api/v1' },
  )

  return app
}
