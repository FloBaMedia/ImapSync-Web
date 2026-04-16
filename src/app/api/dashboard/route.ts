import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const [totalJobs, runningJobs, completedJobs, failedJobs, totalAccounts, successAccounts, failedAccounts, recentJobs] =
    await Promise.all([
      prisma.migrationJob.count(),
      prisma.migrationJob.count({ where: { status: 'RUNNING' } }),
      prisma.migrationJob.count({ where: { status: 'COMPLETED' } }),
      prisma.migrationJob.count({ where: { status: { in: ['FAILED', 'STOPPED'] } } }),
      prisma.migrationAccount.count(),
      prisma.migrationAccount.count({ where: { status: 'SUCCESS' } }),
      prisma.migrationAccount.count({ where: { status: 'FAILED' } }),
      prisma.migrationJob.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          sourceServer: { select: { name: true } },
          destServer: { select: { name: true } },
          _count: { select: { accounts: true } },
        },
      }),
    ])

  return NextResponse.json({
    totalJobs,
    runningJobs,
    completedJobs,
    failedJobs,
    totalAccounts,
    successAccounts,
    failedAccounts,
    recentJobs,
  })
}
