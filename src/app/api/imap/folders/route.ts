import { NextRequest, NextResponse } from 'next/server'
import { listMailbox } from '@/lib/imap-session'
import { resolveImapTarget, type ResolveBody } from '@/lib/imap-target'

export const maxDuration = 90

export async function POST(req: NextRequest) {
  let body: ResolveBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const resolved = await resolveImapTarget(body)
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
  }

  const listing = await listMailbox({
    host: resolved.target.host,
    port: resolved.target.port,
    ssl: resolved.target.ssl,
    user: resolved.target.user,
    pass: resolved.target.pass,
  })

  return NextResponse.json({
    ...listing,
    email: resolved.target.email,
    server: resolved.target.server,
  })
}
