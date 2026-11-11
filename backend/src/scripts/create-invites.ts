import 'dotenv/config'
import { createInvites } from '../auth/invites.js'
import { loadConfig } from '../config.js'
import { createDb } from '../db/client.js'
import { parseInviteArgs } from './invite-args.js'

const config = loadConfig(process.env)
const { db, pool } = createDb(config.databaseUrl)

try {
  const created = await createInvites(
    db,
    parseInviteArgs(process.argv.slice(2)),
  )
  for (const invite of created) console.log(invite.code)
  console.error(
    `Created ${created.length} invite(s), valid until ${created[0]?.expiresAt.toISOString()}`,
  )
} finally {
  await pool.end()
}
