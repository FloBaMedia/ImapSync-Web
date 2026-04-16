'use client'

import { useEffect, useState } from 'react'
import { Nav } from '@/components/Nav'
import { StatusBadge } from '@/components/StatusBadge'
import Link from 'next/link'

interface DashboardData {
  totalJobs: number
  runningJobs: number
  completedJobs: number
  failedJobs: number
  totalAccounts: number
  successAccounts: number
  failedAccounts: number
  recentJobs: {
    id: string
    name: string
    status: string
    createdAt: string
    sourceServer: { name: string }
    destServer: { name: string }
    _count: { accounts: number }
  }[]
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)

  const load = () => fetch('/api/dashboard').then(r => r.json()).then(setData).catch(console.error)

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const pendingAccounts = data ? data.totalAccounts - data.successAccounts - data.failedAccounts : 0

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-gray-500 text-sm mt-0.5">Overview of your email migrations</p>
            </div>
            <Link href="/migrations/new" className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Migration
            </Link>
          </div>

          {/* Job stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard label="Total Jobs"   value={data?.totalJobs ?? 0}     color="text-white" />
            <StatCard label="Running"      value={data?.runningJobs ?? 0}   color="text-blue-400" />
            <StatCard label="Completed"    value={data?.completedJobs ?? 0} color="text-green-400" />
            <StatCard label="Failed / Stopped" value={data?.failedJobs ?? 0} color="text-red-400" />
          </div>

          {/* Account stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <StatCard label="Total Accounts"   value={data?.totalAccounts ?? 0}  color="text-white" />
            <StatCard label="Migrated Successfully" value={data?.successAccounts ?? 0} color="text-green-400" />
            <StatCard label="Pending / Failed" value={pendingAccounts + (data?.failedAccounts ?? 0)} color="text-yellow-400" />
          </div>

          {/* Recent jobs */}
          <div className="card">
            <div className="px-5 py-4 border-b border-[#1e1e2e] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-200">Recent Migrations</h2>
              <Link href="/migrations" className="text-xs text-blue-400 hover:text-blue-300">View all →</Link>
            </div>
            {!data || data.recentJobs.length === 0 ? (
              <div className="px-5 py-10 text-center text-gray-600 text-sm">
                No migrations yet.{' '}
                <Link href="/migrations/new" className="text-blue-400 hover:underline">Get started</Link>
              </div>
            ) : (
              <div className="divide-y divide-[#1e1e2e]">
                {data.recentJobs.map(job => (
                  <Link key={job.id} href={`/migrations/${job.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-[#1a1a2e] transition-colors group">
                    <div>
                      <p className="text-sm font-medium text-gray-200 group-hover:text-white">{job.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {job.sourceServer.name} → {job.destServer.name} · {job._count.accounts} accounts
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <StatusBadge status={job.status} />
                      <span className="text-xs text-gray-600">
                        {new Date(job.createdAt).toLocaleDateString('en-US')}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Getting started tips */}
          {data && data.totalJobs === 0 && (
            <div className="mt-6 card p-6 border-blue-600/20">
              <h3 className="text-sm font-semibold text-blue-400 mb-3">Getting started</h3>
              <ol className="space-y-2 text-sm text-gray-400">
                <li className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center font-bold">1</span>
                  <Link href="/servers" className="hover:text-white">Configure your servers</Link> (source and destination)
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center font-bold">2</span>
                  <Link href="/migrations/new" className="hover:text-white">Create a new migration</Link> and add email accounts
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 text-xs flex items-center justify-center font-bold">3</span>
                  Start the migration and watch live logs per account
                </li>
              </ol>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
