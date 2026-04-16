import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const { name, host, port, ssl, authMech, preset } = body

  const server = await prisma.server.update({
    where: { id },
    data: {
      name: name?.trim(),
      host: host?.trim(),
      port: port ? Number(port) : undefined,
      ssl: ssl !== undefined ? Boolean(ssl) : undefined,
      authMech: authMech || null,
      preset: preset || null,
    },
  })
  return NextResponse.json(server)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.server.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
