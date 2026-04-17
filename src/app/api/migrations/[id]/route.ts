import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/crypto'

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
          options: true,
        },
      },
    },
  })

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(job)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await prisma.migrationJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status === 'RUNNING') {
    return NextResponse.json({ error: 'Cannot delete a running job' }, { status: 409 })
  }
  await prisma.migrationJob.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

type StartMode = 'now' | 'scheduled' | 'queued' | 'draft'

interface EditAccount {
  id?: string
  sourceEmail: string
  sourcePass: string
  destEmail: string
  destPass: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any
}

function resolveStart(mode: StartMode | undefined, scheduledAt: string | null | undefined, queueGroup: string | null | undefined) {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const job = await prisma.migrationJob.findUnique({
    where: { id },
    include: { accounts: { select: { id: true } } },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.status !== 'PENDING') {
    return NextResponse.json({ error: 'Only draft jobs can be edited' }, { status: 409 })
  }

  const body = await req.json()
  const { name, sourceServerId, destServerId, options, concurrency, accounts, startMode, scheduledAt, queueGroup } = body

  if (!name || !sourceServerId || !destServerId) {
    return NextResponse.json({ error: 'Name, source server, and destination server are required' }, { status: 400 })
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json({ error: 'At least one account is required' }, { status: 400 })
  }

  let plan
  try {
    plan = resolveStart(startMode ?? 'draft', scheduledAt, queueGroup)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const existingIds = new Set(job.accounts.map(a => a.id))
  const keepIds = new Set<string>()
  const toCreate: EditAccount[] = []
  const toUpdate: EditAccount[] = []

  for (const acc of accounts) {
    if (acc.id && existingIds.has(acc.id)) {
      keepIds.add(acc.id)
      toUpdate.push(acc)
    } else {
      toCreate.push(acc)
    }
  }
  const toDeleteIds = [...existingIds].filter(eid => !keepIds.has(eid))

  await prisma.$transaction(async tx => {
    await tx.migrationJob.update({
      where: { id },
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
      },
    })

    if (toDeleteIds.length > 0) {
      await tx.migrationAccount.deleteMany({ where: { id: { in: toDeleteIds } } })
    }

    for (const acc of toUpdate) {
      // Empty password = keep existing encrypted value
      const data: Record<string, unknown> = {
        sourceEmail: acc.sourceEmail.trim(),
        destEmail: acc.destEmail.trim(),
        options: acc.options && Object.keys(acc.options).length > 0 ? acc.options : null,
      }
      if (acc.sourcePass) data.sourcePass = encrypt(acc.sourcePass)
      if (acc.destPass)   data.destPass   = encrypt(acc.destPass)
      await tx.migrationAccount.update({ where: { id: acc.id! }, data })
    }

    if (toCreate.length > 0) {
      // New rows must have both passwords
      for (const acc of toCreate) {
        if (!acc.sourcePass || !acc.destPass) {
          throw new Error(`Account ${acc.sourceEmail} is missing a password`)
        }
      }
      await tx.migrationAccount.createMany({
        data: toCreate.map(acc => ({
          jobId: id,
          sourceEmail: acc.sourceEmail.trim(),
          sourcePass: encrypt(acc.sourcePass),
          destEmail: acc.destEmail.trim(),
          destPass: encrypt(acc.destPass),
          options: acc.options && Object.keys(acc.options).length > 0 ? acc.options : undefined,
        })),
      })
    }
  })

  return NextResponse.json({ ok: true })
}
