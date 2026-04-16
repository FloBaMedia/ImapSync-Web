import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const servers = await prisma.server.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(servers)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, host, port, ssl, authMech, preset } = body

  if (!name || !host) {
    return NextResponse.json({ error: 'Name and host are required' }, { status: 400 })
  }

  const server = await prisma.server.create({
    data: {
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 993,
      ssl: ssl !== false,
      authMech: authMech || null,
      preset: preset || null,
    },
  })
  return NextResponse.json(server, { status: 201 })
}
