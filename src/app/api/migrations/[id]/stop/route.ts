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
  if (job.status !== 'RUNNING') {
    return NextResponse.json({ error: 'Job läuft nicht' }, { status: 409 })
  }

  // Signal runner to SIGTERM the imapsync child for each running account.
  // The runner flips status to STOPPED + clears stopRequested when the proc exits.
  await prisma.migrationAccount.updateMany({
    where: { jobId: id, status: 'RUNNING' },
    data: { stopRequested: true },
  })

  // Pending accounts haven't started — mark them STOPPED so the runner skips them.
  await prisma.migrationAccount.updateMany({
    where: { jobId: id, status: 'PENDING' },
    data: { status: 'STOPPED', finishedAt: new Date() },
  })

  await prisma.migrationJob.update({
    where: { id },
    data: { status: 'STOPPED', finishedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
