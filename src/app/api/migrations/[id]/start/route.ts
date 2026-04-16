import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
  if (job.status === 'RUNNING') {
    return NextResponse.json({ error: 'Job läuft bereits' }, { status: 409 })
  }

  // Reset finished/aborted accounts to PENDING when re-running
  if (['COMPLETED', 'FAILED', 'STOPPED'].includes(job.status)) {
    await prisma.migrationAccount.updateMany({
      where: { jobId: id, status: { in: ['FAILED', 'SKIPPED', 'STOPPED'] } },
      data: { status: 'PENDING', startedAt: null, finishedAt: null, exitCode: null, stopRequested: false },
    })
  }

  // Runner picks this up on its next tick (poll interval ~1s)
  await prisma.migrationJob.update({
    where: { id },
    data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null },
  })

  return NextResponse.json({ ok: true })
}
