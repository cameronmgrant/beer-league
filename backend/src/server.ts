import 'dotenv/config'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb } from './db/client.js'
import { LocalDiskStorage } from './photos/local-storage.js'

const config = loadConfig(process.env)
const { db, pool } = createDb(config.databaseUrl)
const storage = new LocalDiskStorage(config.photoStorageDir)
const app = buildApp({
  db,
  storage,
  logLevel: config.logLevel,
  cookieSecure: config.nodeEnv === 'production',
  allowedOrigins: config.allowedOrigins,
  trustProxyHops: config.trustProxyHops,
  authRateLimit: config.authRateLimit,
  uploadRateLimit: config.uploadRateLimit,
})

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await pool.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ port: config.port, host: config.host })
