import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await prisma.migrationJob.findUnique({
    where: { id },
    include: {
      sourceServer: true,
      destServer: true,
      accounts: {
        orderBy: { sourceEmail: 'asc' },
        select: {
          id: true,
          sourceEmail: true,
          destEmail: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          exitCode: true,
        },
      },
    },
  })

  if (!job) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  return NextResponse.json(job)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await prisma.migrationJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  if (job.status === 'RUNNING') {
    return NextResponse.json({ error: 'Laufende Jobs können nicht gelöscht werden' }, { status: 409 })
  }
  await prisma.migrationJob.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
