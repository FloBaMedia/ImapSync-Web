import { spawn, ChildProcess } from 'child_process'
import { prisma } from './prisma'
import { decrypt } from './crypto'
import { getOrCreateEmitter, emitLog, closeStream } from './events'

// In-memory process registry (safe in single-process Docker deployment)
const processes = new Map<string, ChildProcess>()
const accountToJob = new Map<string, string>()

export function isAccountRunning(accountId: string): boolean {
  return processes.has(accountId)
}

export function stopAccount(accountId: string): boolean {
  const proc = processes.get(accountId)
  if (!proc) return false
  proc.kill('SIGTERM')
  return true
}

export function stopAllForJob(jobId: string): void {
  for (const [accountId, jId] of accountToJob.entries()) {
    if (jId === jobId) {
      const proc = processes.get(accountId)
      if (proc) proc.kill('SIGTERM')
    }
  }
}

export interface ImapsyncOptions {
  ssl1?: boolean
  ssl2?: boolean
  subfolder2?: string
  exclude?: string
  automap?: boolean
  addheader?: boolean
  syncinternaldates?: boolean
  useuid?: boolean
  authMech1?: string
  authMech2?: string
  regextrans2?: string | string[]
  extraArgs?: string
}

async function saveLogBatch(accountId: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return
  await prisma.migrationLog.createMany({
    data: lines.map(line => ({ accountId, line })),
  })
}

export async function runMigrationAccount(
  accountId: string,
  sourceHost: string,
  sourcePort: number,
  destHost: string,
  destPort: number,
  options: ImapsyncOptions
): Promise<void> {
  const account = await prisma.migrationAccount.findUnique({ where: { id: accountId } })
  if (!account) throw new Error('Account not found')

  const sourcePass = decrypt(account.sourcePass)
  const destPass = decrypt(account.destPass)

  const args: string[] = [
    '--host1', sourceHost, '--port1', String(sourcePort),
    '--user1', account.sourceEmail, '--password1', sourcePass,
    '--host2', destHost, '--port2', String(destPort),
    '--user2', account.destEmail, '--password2', destPass,
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
    const rules = Array.isArray(options.regextrans2)
      ? options.regextrans2
      : options.regextrans2.split('\n')
    for (const rule of rules) {
      if (rule.trim()) args.push('--regextrans2', rule.trim())
    }
  }
  if (options.extraArgs?.trim()) {
    args.push(...options.extraArgs.trim().split(/\s+/))
  }

  await prisma.migrationAccount.update({
    where: { id: accountId },
    data: { status: 'RUNNING', startedAt: new Date() },
  })

  getOrCreateEmitter(accountId) // create before spawn so SSE clients can subscribe
  const proc = spawn('imapsync', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  processes.set(accountId, proc)
  accountToJob.set(accountId, account.jobId)

  const logBuffer: string[] = []
  let bufferTimer: ReturnType<typeof setTimeout> | null = null

  const flushBuffer = async () => {
    if (logBuffer.length === 0) return
    const toSave = logBuffer.splice(0)
    await saveLogBatch(accountId, toSave).catch(console.error)
  }

  const handleLine = (line: string) => {
    const trimmed = line.replace(/\r/g, '').trimEnd()
    if (!trimmed) return
    emitLog(accountId, trimmed)
    logBuffer.push(trimmed)
    if (logBuffer.length >= 100) {
      if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = null }
      flushBuffer()
    } else if (!bufferTimer) {
      bufferTimer = setTimeout(() => { bufferTimer = null; flushBuffer() }, 2000)
    }
  }

  const processOutput = (data: Buffer) => data.toString().split('\n').forEach(handleLine)
  proc.stdout?.on('data', processOutput)
  proc.stderr?.on('data', processOutput)

  return new Promise(resolve => {
    proc.on('close', async code => {
      if (bufferTimer) clearTimeout(bufferTimer)
      await flushBuffer()
      processes.delete(accountId)
      accountToJob.delete(accountId)

      const current = await prisma.migrationAccount.findUnique({ where: { id: accountId } })
      if (current?.status !== 'STOPPED') {
        await prisma.migrationAccount.update({
          where: { id: accountId },
          data: { status: code === 0 ? 'SUCCESS' : 'FAILED', finishedAt: new Date(), exitCode: code ?? -1 },
        })
      }
      closeStream(accountId)
      resolve()
    })
  })
}

async function runWithConcurrency(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (idx < tasks.length) {
      await tasks[idx++]().catch(console.error)
    }
  })
  await Promise.all(workers)
}

export async function startJob(jobId: string): Promise<void> {
  const job = await prisma.migrationJob.findUnique({
    where: { id: jobId },
    include: {
      sourceServer: true,
      destServer: true,
      accounts: { where: { status: 'PENDING' } },
    },
  })
  if (!job) throw new Error('Job not found')

  await prisma.migrationJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  })

  const options = (job.options as ImapsyncOptions) ?? {}

  const tasks = job.accounts.map(account => async () => {
    const currentJob = await prisma.migrationJob.findUnique({ where: { id: jobId }, select: { status: true } })
    if (currentJob?.status === 'STOPPED') {
      await prisma.migrationAccount.update({ where: { id: account.id }, data: { status: 'SKIPPED' } })
      return
    }
    await runMigrationAccount(account.id, job.sourceServer.host, job.sourceServer.port, job.destServer.host, job.destServer.port, options)
  })

  runWithConcurrency(tasks, job.concurrency)
    .then(async () => {
      const current = await prisma.migrationJob.findUnique({ where: { id: jobId }, select: { status: true } })
      if (current?.status === 'RUNNING') {
        await prisma.migrationJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', finishedAt: new Date() } })
      }
    })
    .catch(async err => {
      console.error('Job error:', err)
      await prisma.migrationJob.update({ where: { id: jobId }, data: { status: 'FAILED', finishedAt: new Date() } })
    })
}
