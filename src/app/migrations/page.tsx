'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Nav } from '@/components/Nav'
import { StatusBadge } from '@/components/StatusBadge'

interface Progress {
  SUCCESS?: number
  FAILED?: number
  RUNNING?: number
  PENDING?: number
  STOPPED?: number
  SKIPPED?: number
}

interface MigrationJob {
  id: string
  name: string
  status: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  scheduledAt: string | null
  queueGroup: string | null
  concurrency: number
  sourceServer: { name: string; host: string }
  destServer: { name: string; host: string }
  _count: { accounts: number }
  progress: Progress
}

function ProgressBar({ total, progress }: { total: number; progress: Progress }) {
  const success = progress.SUCCESS ?? 0
  const failed = progress.FAILED ?? 0
  const running = progress.RUNNING ?? 0
  if (total === 0) return null
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${(success / total) * 100}%` }} />
        <div className="bg-red-500 h-full transition-all" style={{ width: `${(failed / total) * 100}%` }} />
        <div className="bg-blue-500 h-full pulse-dot transition-all" style={{ width: `${(running / total) * 100}%` }} />
      </div>
      <span className="text-xs text-gray-500 whitespace-nowrap">{success + failed}/{total}</span>
    </div>
  )
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start) return null
  const secs = Math.floor((((end ? new Date(end) : new Date()).getTime()) - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

export default function MigrationsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<MigrationJob[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const data = await fetch('/api/migrations').then(r => r.json())
    setJobs(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [])

  const handleStart = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    await fetch(`/api/migrations/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'now' }),
    })
    load()
  }

  const handleStop = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (!confirm('Stop this migration?')) return
    await fetch(`/api/migrations/${id}/stop`, { method: 'POST' })
    load()
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    if (!confirm('Delete this migration? This cannot be undone.')) return
    await fetch(`/api/migrations/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">Migrations</h1>
              <p className="text-gray-500 text-sm mt-0.5">{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}</p>
            </div>
            <Link href="/migrations/new" className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New migration
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-20 text-gray-600">Loading...</div>
          ) : jobs.length === 0 ? (
            <div className="card p-16 text-center">
              <div className="text-5xl mb-4">🔄</div>
              <p className="text-gray-400">No migrations yet.</p>
              <Link href="/migrations/new" className="btn-primary mt-4 inline-flex">Create your first migration</Link>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Servers</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Schedule</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Accounts</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e1e2e]">
                  {jobs.map(job => (
                    <tr key={job.id} onClick={() => router.push(`/migrations/${job.id}`)} className="hover:bg-[#1a1a2e] cursor-pointer transition-colors">
                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-gray-200">{job.name}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{new Date(job.createdAt).toLocaleDateString('en-US')}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-xs text-gray-400">{job.sourceServer.name}</p>
                        <p className="text-xs text-gray-600">→ {job.destServer.name}</p>
                      </td>
                      <td className="px-5 py-4"><StatusBadge status={job.status} /></td>
                      <td className="px-5 py-4 text-xs">
                        {job.scheduledAt && <p className="text-purple-300">⏰ {new Date(job.scheduledAt).toLocaleString('en-US')}</p>}
                        {job.queueGroup && <p className="text-purple-300">📋 {job.queueGroup}</p>}
                        {!job.scheduledAt && !job.queueGroup && <p className="text-gray-600">—</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm text-gray-300">{job._count.accounts}</span>
                        <ProgressBar total={job._count.accounts} progress={job.progress} />
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {formatDuration(job.startedAt, job.finishedAt) ?? '—'}
                      </td>
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 justify-end">
                          {job.status === 'RUNNING' ? (
                            <button onClick={e => handleStop(e, job.id)} className="btn-danger text-xs px-3 py-1.5">Stop</button>
                          ) : (
                            <button onClick={e => handleStart(e, job.id)} className="btn-success text-xs px-3 py-1.5">
                              {['COMPLETED', 'FAILED', 'STOPPED'].includes(job.status) ? 'Retry' : 'Start'}
                            </button>
                          )}
                          {job.status !== 'RUNNING' && (
                            <button onClick={e => handleDelete(e, job.id)} className="btn-danger text-xs px-3 py-1.5">Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
