import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'

export interface ImapTarget {
  host: string
  port: number
  ssl: boolean
  user: string
  pass: string
  email: string
  server: { name: string; host: string }
}

export type ResolveBody = {
  serverId?: string
  email?: string
  password?: string
  accountId?: string
  side?: 'source' | 'dest'
}

export async function resolveImapTarget(body: ResolveBody): Promise<
  { ok: true; target: ImapTarget } | { ok: false; error: string; status: number }
> {
  if (body.serverId && body.email && body.password) {
    const server = await prisma.server.findUnique({ where: { id: body.serverId } })
    if (!server) return { ok: false, error: 'Server not found', status: 404 }
    return {
      ok: true,
      target: {
        host: server.host,
        port: server.port,
        ssl: server.ssl,
        user: body.email,
        pass: body.password,
        email: body.email,
        server: { name: server.name, host: server.host },
      },
    }
  }

  if (body.accountId && (body.side === 'source' || body.side === 'dest')) {
    const account = await prisma.migrationAccount.findUnique({
      where: { id: body.accountId },
      include: { job: { include: { sourceServer: true, destServer: true } } },
    })
    if (!account) return { ok: false, error: 'Account not found', status: 404 }
    const server = body.side === 'source' ? account.job.sourceServer : account.job.destServer
    const email = body.side === 'source' ? account.sourceEmail : account.destEmail
    let pass: string
    try {
      pass = decrypt(body.side === 'source' ? account.sourcePass : account.destPass)
    } catch (e) {
      return { ok: false, error: `Could not decrypt stored password: ${(e as Error).message}`, status: 500 }
    }
    return {
      ok: true,
      target: {
        host: server.host,
        port: server.port,
        ssl: server.ssl,
        user: email,
        pass,
        email,
        server: { name: server.name, host: server.host },
      },
    }
  }

  return {
    ok: false,
    error: 'Send either { serverId, email, password } or { accountId, side }',
    status: 400,
  }
}

export function mergeMailboxOptions(
  jobOptions: unknown,
  accountOptions: unknown,
): { automap: boolean; subfolder2: string; exclude: string; regextrans2: string } {
  const job = (jobOptions ?? {}) as Record<string, unknown>
  const acc = (accountOptions ?? {}) as Record<string, unknown>
  const pick = (key: string) => {
    const a = acc[key]
    if (typeof a === 'string' && a.trim()) return a
    const j = job[key]
    return typeof j === 'string' ? j : ''
  }
  return {
    automap: job.automap !== false,
    subfolder2: pick('subfolder2'),
    exclude: pick('exclude'),
    regextrans2: pick('regextrans2'),
  }
}
