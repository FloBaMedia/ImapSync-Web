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

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, sourceServerId, destServerId, options, concurrency, accounts } = body

  if (!name || !sourceServerId || !destServerId) {
    return NextResponse.json({ error: 'Name, source server, and destination server are required' }, { status: 400 })
  }

  const job = await prisma.migrationJob.create({
    data: {
      name: name.trim(),
      sourceServerId,
      destServerId,
      options: options ?? {},
      concurrency: Number(concurrency) || 1,
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
