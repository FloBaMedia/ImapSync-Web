import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'

export async function GET() {
  const jobs = await prisma.migrationJob.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      sourceServer: { select: { id: true, name: true, host: true } },
      destServer: { select: { id: true, name: true, host: true } },
      _count: { select: { accounts: true } },
    },
  })

  const jobsWithProgress = await Promise.all(
    jobs.map(async job => {
      const counts = await prisma.migrationAccount.groupBy({
        by: ['status'],
        where: { jobId: job.id },
        _count: true,
      })
      const progress = Object.fromEntries(counts.map(c => [c.status, c._count]))
      return { ...job, progress }
    })
  )

  return NextResponse.json(jobsWithProgress)
}

type StartMode = 'now' | 'scheduled' | 'queued' | 'draft'

function resolveStart(mode: StartMode | undefined, scheduledAt: string | null | undefined, queueGroup: string | null | undefined) {
  // Returns { status, scheduledAt, queueGroup, startedAt }
  const group = queueGroup?.trim() || null
  const at = scheduledAt ? new Date(scheduledAt) : null
  switch (mode) {
    case 'now':
      return { status: 'RUNNING', scheduledAt: null, queueGroup: group, startedAt: new Date() }
    case 'scheduled':
      if (!at || isNaN(at.getTime())) throw new Error('scheduledAt is required for mode "scheduled"')
      return { status: 'SCHEDULED', scheduledAt: at, queueGroup: group, startedAt: null }
    case 'queued':
      if (!group) throw new Error('queueGroup is required for mode "queued"')
      return { status: 'SCHEDULED', scheduledAt: at, queueGroup: group, startedAt: null }
    case 'draft':
    default:
      return { status: 'PENDING', scheduledAt: at, queueGroup: group, startedAt: null }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, sourceServerId, destServerId, options, concurrency, accounts, startMode, scheduledAt, queueGroup } = body

  if (!name || !sourceServerId || !destServerId) {
    return NextResponse.json({ error: 'Name, source server, and destination server are required' }, { status: 400 })
  }

  let plan
  try {
    plan = resolveStart(startMode, scheduledAt, queueGroup)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const job = await prisma.migrationJob.create({
    data: {
      name: name.trim(),
      sourceServerId,
      destServerId,
      options: options ?? {},
      concurrency: Number(concurrency) || 1,
      status: plan.status,
      scheduledAt: plan.scheduledAt,
      queueGroup: plan.queueGroup,
      startedAt: plan.startedAt,
      accounts: {
        create: (accounts ?? []).map((a: {
          sourceEmail: string
          sourcePass: string
          destEmail: string
          destPass: string
        }) => ({
          sourceEmail: a.sourceEmail.trim(),
          sourcePass: encrypt(a.sourcePass),
          destEmail: a.destEmail.trim(),
          destPass: encrypt(a.destPass),
        })),
      },
    },
    include: { sourceServer: true, destServer: true, accounts: true },
  })

  return NextResponse.json(job, { status: 201 })
}
