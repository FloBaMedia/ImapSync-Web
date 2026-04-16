import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stopAllForJob } from '@/lib/imapsync'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await prisma.migrationJob.findUnique({
    where: { id },
    select: { status: true },
  })

  if (!job) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })
  if (job.status !== 'RUNNING') {
    return NextResponse.json({ error: 'Job läuft nicht' }, { status: 409 })
  }

  stopAllForJob(id)

  await prisma.migrationJob.update({
    where: { id },
    data: { status: 'STOPPED', finishedAt: new Date() },
  })

  await prisma.migrationAccount.updateMany({
    where: { jobId: id, status: 'RUNNING' },
    data: { status: 'STOPPED', finishedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
