import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { testImapLogin } from '@/lib/imap-test'

interface AdHocBody {
  serverId: string
  email: string
  password: string
}

interface StoredBody {
  accountId: string
  side: 'source' | 'dest'
}

type Body = Partial<AdHocBody & StoredBody>

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  // Mode A: ad-hoc credentials (new-migration page, or edit page when password was retyped)
  if (body.serverId && body.email && body.password) {
    const server = await prisma.server.findUnique({ where: { id: body.serverId } })
    if (!server) return NextResponse.json({ ok: false, error: 'Server not found' }, { status: 404 })
    const result = await testImapLogin({
      host: server.host, port: server.port, ssl: server.ssl,
      user: body.email, pass: body.password,
    })
    return NextResponse.json(result)
  }

  // Mode B: stored credentials of an existing draft account
  if (body.accountId && (body.side === 'source' || body.side === 'dest')) {
    const account = await prisma.migrationAccount.findUnique({
      where: { id: body.accountId },
      include: { job: { include: { sourceServer: true, destServer: true } } },
    })
    if (!account) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 })

    const server = body.side === 'source' ? account.job.sourceServer : account.job.destServer
    const email  = body.side === 'source' ? account.sourceEmail      : account.destEmail
    let pass: string
    try {
      pass = decrypt(body.side === 'source' ? account.sourcePass : account.destPass)
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Could not decrypt stored password: ${(e as Error).message}` })
    }

    const result = await testImapLogin({
      host: server.host, port: server.port, ssl: server.ssl,
      user: email, pass,
    })
    return NextResponse.json(result)
  }

  return NextResponse.json(
    { ok: false, error: 'Send either { serverId, email, password } or { accountId, side }' },
    { status: 400 },
  )
}
