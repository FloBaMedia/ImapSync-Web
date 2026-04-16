import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startJob } from '@/lib/imapsync'

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

  // Reset FAILED/SKIPPED accounts to PENDING when restarting
  if (['COMPLETED', 'FAILED', 'STOPPED'].includes(job.status)) {
    await prisma.migrationAccount.updateMany({
      where: { jobId: id, status: { in: ['FAILED', 'SKIPPED'] } },
      data: { status: 'PENDING', startedAt: null, finishedAt: null, exitCode: null },
    })
  }

  // Fire and forget – startJob runs processes in the background
  startJob(id).catch(console.error)

  return NextResponse.json({ ok: true })
}
