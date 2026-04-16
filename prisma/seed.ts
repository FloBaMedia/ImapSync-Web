import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD ?? 'admin'

  const existing = await prisma.adminUser.findUnique({ where: { email } })
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.adminUser.create({ data: { email, passwordHash } })
    console.log(`Admin user created: ${email}`)
  } else {
    console.log(`Admin user already exists: ${email}`)
  }

  const defaults = [
    { key: 'ssl1', value: 'true' },
    { key: 'ssl2', value: 'true' },
    { key: 'automap', value: 'true' },
    { key: 'addheader', value: 'true' },
    { key: 'syncinternaldates', value: 'true' },
    { key: 'useuid', value: 'true' },
    { key: 'subfolder2', value: '' },
    { key: 'exclude', value: '(?i)Spam|Trash|Junk' },
    { key: 'regextrans2', value: '' },
    { key: 'extraArgs', value: '' },
  ]

  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    })
  }

  console.log('Default settings applied.')
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
