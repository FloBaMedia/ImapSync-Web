import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Mode = 'now' | 'scheduled' | 'queued'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Body is optional — empty body = start now (backward compatible)
  let mode: Mode = 'now'
  let scheduledAt: string | null | undefined
  let queueGroup: string | null | undefined
  try {
    const body = await req.json()
    mode = (body.mode as Mode) ?? 'now'
    scheduledAt = body.scheduledAt
    queueGroup = body.queueGroup
  } catch { /* no body */ }

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

  const group = queueGroup?.trim() || null
  const at = scheduledAt ? new Date(scheduledAt) : null

  let data: { status: string; scheduledAt: Date | null; queueGroup: string | null; startedAt: Date | null; finishedAt: null }
  if (mode === 'now') {
    data = { status: 'RUNNING', scheduledAt: null, queueGroup: group, startedAt: new Date(), finishedAt: null }
  } else if (mode === 'scheduled') {
    if (!at || isNaN(at.getTime())) {
      return NextResponse.json({ error: 'scheduledAt is required for mode "scheduled"' }, { status: 400 })
    }
    data = { status: 'SCHEDULED', scheduledAt: at, queueGroup: group, startedAt: null, finishedAt: null }
  } else if (mode === 'queued') {
    if (!group) {
      return NextResponse.json({ error: 'queueGroup is required for mode "queued"' }, { status: 400 })
    }
    data = { status: 'SCHEDULED', scheduledAt: at, queueGroup: group, startedAt: null, finishedAt: null }
  } else {
    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
  }

  // Runner picks this up on its next tick (poll interval ~1s)
  await prisma.migrationJob.update({ where: { id }, data })

  return NextResponse.json({ ok: true })
}
