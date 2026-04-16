import { spawn } from 'child_process'
import { createWriteStream, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const { PrismaClient } = await import(resolve(__dirname, '../src/generated/prisma/client.js'))
const { PrismaPg } = await import('@prisma/adapter-pg')
const { Pool } = await import('pg')

const LOG_DIR = process.env.LOG_DIR || '/shared/logs'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000)
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 50)

mkdirSync(LOG_DIR, { recursive: true })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// accountId -> { proc, logStream, killed }
const processes = new Map()

const ALGORITHM = 'aes-256-gcm'
function decryptPassword(data) {
  const hex = process.env.ENCRYPTION_KEY ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'
  const key = Buffer.from(hex, 'hex').slice(0, 32)
  const parts = data.split(':')
  if (parts.length !== 3) return data
  const [ivB64, tagB64, encrypted] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  let decrypted = decipher.update(encrypted, 'base64', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function buildArgs(job, account, options) {
  const args = [
    '--host1', job.sourceServer.host, '--port1', String(job.sourceServer.port),
    '--user1', account.sourceEmail, '--password1', decryptPassword(account.sourcePass),
    '--host2', job.destServer.host, '--port2', String(job.destServer.port),
    '--user2', account.destEmail, '--password2', decryptPassword(account.destPass),
    '--nolog',
  ]
  if (options.ssl1 !== false) args.push('--ssl1')
  if (options.ssl2 !== false) args.push('--ssl2')
  if (options.subfolder2) args.push('--subfolder2', options.subfolder2)
  if (options.exclude) args.push('--exclude', options.exclude)
  if (options.automap !== false) args.push('--automap')
  if (options.addheader !== false) args.push('--addheader')
  if (options.syncinternaldates !== false) args.push('--syncinternaldates')
  if (options.useuid !== false) args.push('--useuid')
  if (options.authMech1) args.push('--authmech1', options.authMech1)
  if (options.authMech2) args.push('--authmech2', options.authMech2)
  if (options.regextrans2) {
    const rules = Array.isArray(options.regextrans2) ? options.regextrans2 : options.regextrans2.split('\n')
    for (const r of rules) {
      if (r.trim()) args.push('--regextrans2', r.trim())
    }
  }
  if (options.extraArgs?.trim()) {
    args.push(...options.extraArgs.trim().split(/\s+/))
  }
  return args
}

async function startAccount(job, account) {
  // Account-level options override job-level options key by key
  const options = { ...(job.options ?? {}), ...(account.options ?? {}) }
  const args = buildArgs(job, account, options)
  const logPath = path.join(LOG_DIR, `${account.id}.log`)
  // truncate log file at start so re-runs don't accumulate
  const logStream = createWriteStream(logPath, { flags: 'w' })

  await prisma.migrationAccount.update({
    where: { id: account.id },
    data: { status: 'RUNNING', startedAt: new Date(), exitCode: null, finishedAt: null, stopRequested: false },
  })

  const proc = spawn('imapsync', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const entry = { proc, logStream, killed: false }
  processes.set(account.id, entry)

  let buf = ''
  const handle = (chunk) => {
    buf += chunk.toString()
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r/g, '')
      buf = buf.slice(idx + 1)
      logStream.write(line + '\n')
    }
  }
  proc.stdout.on('data', handle)
  proc.stderr.on('data', handle)

  proc.on('error', (err) => {
    console.error(`imapsync spawn error for ${account.id}:`, err)
  })

  proc.on('close', async (code) => {
    if (buf) logStream.write(buf.replace(/\r/g, '') + '\n')
    try { logStream.end() } catch {}
    processes.delete(account.id)

    // shutdown() already reset the account to PENDING for resume on next start
    if (entry.shuttingDown) return

    const status = entry.killed ? 'STOPPED' : code === 0 ? 'SUCCESS' : 'FAILED'
    try {
      await prisma.migrationAccount.update({
        where: { id: account.id },
        data: { status, exitCode: code ?? -1, finishedAt: new Date(), stopRequested: false },
      })
    } catch (e) {
      console.error(`Failed to update account ${account.id} after exit:`, e)
    }
  })
}

async function promoteScheduledJobs() {
  // Promote SCHEDULED -> RUNNING when:
  //   * scheduledAt is null OR <= now
  //   * AND no other RUNNING job shares this job's queueGroup (if set)
  const now = new Date()
  const candidates = await prisma.migrationJob.findMany({
    where: {
      status: 'SCHEDULED',
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, queueGroup: true, name: true },
  })
  if (candidates.length === 0) return

  const busyGroups = new Set(
    (await prisma.migrationJob.findMany({
      where: { status: 'RUNNING', queueGroup: { not: null } },
      select: { queueGroup: true },
    })).map(j => j.queueGroup)
  )

  for (const c of candidates) {
    if (c.queueGroup && busyGroups.has(c.queueGroup)) continue
    const result = await prisma.migrationJob.updateMany({
      where: { id: c.id, status: 'SCHEDULED' }, // guard against races
      data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null },
    })
    if (result.count === 0) continue
    if (c.queueGroup) busyGroups.add(c.queueGroup)
    console.log(`Promoted SCHEDULED -> RUNNING: ${c.name} (${c.id})${c.queueGroup ? ` [queue=${c.queueGroup}]` : ''}`)
  }
}

async function tick() {
  // 0. Promote any due SCHEDULED jobs (time-based + queue-group respecting)
  await promoteScheduledJobs()

  // 1. Honor stop requests for running children
  if (processes.size > 0) {
    const stopAccs = await prisma.migrationAccount.findMany({
      where: { id: { in: Array.from(processes.keys()) }, stopRequested: true },
      select: { id: true },
    })
    for (const a of stopAccs) {
      const entry = processes.get(a.id)
      if (entry && !entry.killed) {
        entry.killed = true
        entry.proc.kill('SIGTERM')
      }
    }
  }

  // 2. Spawn new accounts for RUNNING jobs
  const runningJobs = await prisma.migrationJob.findMany({
    where: { status: 'RUNNING' },
    include: { sourceServer: true, destServer: true, accounts: true },
  })

  for (const job of runningJobs) {
    const myRunningCount = job.accounts.filter(a => a.status === 'RUNNING' && processes.has(a.id)).length
    const slotsFree = job.concurrency - myRunningCount
    const globalSlots = MAX_PARALLEL - processes.size
    const toStart = Math.min(slotsFree, globalSlots)

    if (toStart > 0) {
      const pendingAccs = job.accounts.filter(a => a.status === 'PENDING').slice(0, toStart)
      for (const acc of pendingAccs) {
        startAccount(job, acc).catch(err => console.error('startAccount error:', err))
      }
    }

    // 3. Detect job completion
    const refreshed = await prisma.migrationAccount.findMany({
      where: { jobId: job.id },
      select: { status: true },
    })
    const stillActive = refreshed.some(a => a.status === 'PENDING' || a.status === 'RUNNING')
    if (!stillActive) {
      const hasFailed = refreshed.some(a => a.status === 'FAILED')
      const hasSuccess = refreshed.some(a => a.status === 'SUCCESS')
      const finalStatus = hasFailed ? 'FAILED' : hasSuccess ? 'COMPLETED' : 'STOPPED'
      await prisma.migrationJob.update({
        where: { id: job.id },
        data: { status: finalStatus, finishedAt: new Date() },
      })
      console.log(`Job ${job.id} -> ${finalStatus}`)
    }
  }
}

async function recovery() {
  // Accounts marked RUNNING in DB but we have no in-memory process for them
  // (=runner crashed mid-job). For jobs still RUNNING, reset to PENDING so we
  // pick them up. Imapsync resumes safely (skips already-synced messages).
  const stuck = await prisma.migrationAccount.updateMany({
    where: { status: 'RUNNING', job: { status: 'RUNNING' } },
    data: { status: 'PENDING', startedAt: null, stopRequested: false },
  })
  if (stuck.count > 0) console.log(`Recovery: reset ${stuck.count} stuck accounts to PENDING`)

  // Jobs that were stopped/completed but have orphan RUNNING accounts -> mark STOPPED
  const orphan = await prisma.migrationAccount.updateMany({
    where: { status: 'RUNNING', job: { status: { not: 'RUNNING' } } },
    data: { status: 'STOPPED', finishedAt: new Date(), stopRequested: false },
  })
  if (orphan.count > 0) console.log(`Recovery: marked ${orphan.count} orphan accounts STOPPED`)
}

async function waitForDb() {
  // Probe a schema table (not just SELECT 1) so we also wait for the app
  // container to finish `prisma migrate deploy` before proceeding.
  for (let i = 0; i < 120; i++) {
    try {
      await prisma.$queryRaw`SELECT 1 FROM "MigrationAccount" LIMIT 1`
      return
    } catch {
      if (i === 0) console.log('Waiting for DB schema (app container migrations)...')
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw new Error('DB schema not ready after 120s')
}

async function shutdown() {
  console.log('Shutting down runner...')
  // Mark first so close-handlers skip their final DB update
  for (const entry of processes.values()) entry.shuttingDown = true

  for (const [id, { proc, logStream }] of processes) {
    try { proc.kill('SIGTERM') } catch {}
    try { logStream.end() } catch {}
    try {
      // Resume on next runner start (imapsync skips already-synced messages)
      await prisma.migrationAccount.update({
        where: { id },
        data: { status: 'PENDING', startedAt: null, stopRequested: false },
      })
    } catch {}
  }
  try { await prisma.$disconnect() } catch {}
  try { await pool.end() } catch {}
  process.exit(0)
}

async function main() {
  console.log(`Runner starting. LOG_DIR=${LOG_DIR} POLL=${POLL_INTERVAL_MS}ms MAX_PARALLEL=${MAX_PARALLEL}`)
  await waitForDb()
  console.log('DB ready.')
  await recovery()

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  while (true) {
    try {
      await tick()
    } catch (e) {
      console.error('Tick error:', e)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
