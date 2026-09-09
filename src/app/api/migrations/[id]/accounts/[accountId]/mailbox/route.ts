import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { listMailbox } from '@/lib/imap-session'
import { compareMailboxes } from '@/lib/mailbox-compare'
import { mergeMailboxOptions } from '@/lib/imap-target'

export const maxDuration = 90

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  const { id, accountId } = await params
  const account = await prisma.migrationAccount.findUnique({
    where: { id: accountId },
    include: { job: { include: { sourceServer: true, destServer: true } } },
  })
  if (!account || account.jobId !== id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  let sourcePass: string
  let destPass: string
  try {
    sourcePass = decrypt(account.sourcePass)
    destPass = decrypt(account.destPass)
  } catch (e) {
    return NextResponse.json({ error: `Could not decrypt stored password: ${(e as Error).message}` }, { status: 500 })
  }

  const sourceServer = account.job.sourceServer
  const destServer = account.job.destServer

  const [source, dest] = await Promise.all([
    listMailbox({
      host: sourceServer.host, port: sourceServer.port, ssl: sourceServer.ssl,
      user: account.sourceEmail, pass: sourcePass,
    }),
    listMailbox({
      host: destServer.host, port: destServer.port, ssl: destServer.ssl,
      user: account.destEmail, pass: destPass,
    }),
  ])

  const sourceListing = {
    ...source,
    email: account.sourceEmail,
    server: { name: sourceServer.name, host: sourceServer.host },
  }
  const destListing = {
    ...dest,
    email: account.destEmail,
    server: { name: destServer.name, host: destServer.host },
  }

  const options = mergeMailboxOptions(account.job.options, account.options)
  const compare = source.ok && dest.ok
    ? compareMailboxes(source.folders, dest.folders, dest.delimiter, options)
    : null

  return NextResponse.json({
    source: sourceListing,
    dest: destListing,
    compare,
    options,
    account: {
      id: account.id,
      sourceEmail: account.sourceEmail,
      destEmail: account.destEmail,
      status: account.status,
    },
  })
}
