// Docker entrypoint initialization for the app container:
// creates admin user and seeds default settings. Job/account state recovery
// is the runner container's responsibility (see scripts/runner.mjs).
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const { PrismaClient } = await import(resolve(__dirname, '../src/generated/prisma/client.js'))
const { PrismaPg } = await import('@prisma/adapter-pg')
const { Pool } = await import('pg')
const bcrypt = (await import('bcryptjs')).default

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

try {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD || 'admin'
  const existing = await prisma.adminUser.findUnique({ where: { email } })
  if (!existing) {
    const passwordHash = bcrypt.hashSync(password, 12)
    await prisma.adminUser.create({ data: { email, passwordHash } })
    console.log('Admin user created: ' + email)
  }

  const defaults = [
    ['ssl1', 'true'], ['ssl2', 'true'], ['automap', 'true'],
    ['addheader', 'true'], ['syncinternaldates', 'true'], ['useuid', 'true'],
    ['subfolder2', ''], ['exclude', '(?i)Spam|Trash|Junk'],
    ['regextrans2', ''], ['extraArgs', ''],
  ]
  for (const [key, value] of defaults) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } })
  }

  console.log('Initialization complete.')
} finally {
  await prisma.$disconnect()
  await pool.end()
}
