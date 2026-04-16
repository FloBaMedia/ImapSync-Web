'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { StatusBadge } from '@/components/StatusBadge'
import { LogViewer } from '@/components/LogViewer'

interface Account {
  id: string
  sourceEmail: string
  destEmail: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
}

interface Job {
  id: string
  name: string
  status: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  concurrency: number
  sourceServer: { name: string; host: string; port: number }
  destServer: { name: string; host: string; port: number }
  accounts: Account[]
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—'
  const secs = Math.floor((((end ? new Date(end) : new Date()).getTime()) - new Date(start).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

export default function MigrationDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [logAccount, setLogAccount] = useState<Account | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/migrations/${id}`)
    if (!res.ok) { router.push('/migrations'); return }
    setJob(await res.json())
    setLoading(false)
  }, [id, router])

  useEffect(() => {
    load()
    const interval = setInterval(load, 3000)
    return () => clearInterval(interval)
  }, [load])

  const handleStart = async () => {
    setActionLoading(true)
    await fetch(`/api/migrations/${id}/start`, { method: 'POST' })
    await load()
    setActionLoading(false)
  }

  const handleStop = async () => {
    if (!confirm('Stop this migration?')) return
    setActionLoading(true)
    await fetch(`/api/migrations/${id}/stop`, { method: 'POST' })
    await load()
    setActionLoading(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this migration? This cannot be undone.')) return
    await fetch(`/api/migrations/${id}`, { method: 'DELETE' })
    router.push('/migrations')
  }

  if (loading) return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 flex items-center justify-center text-gray-600">Loading...</main>
    </div>
  )
  if (!job) return null

  const total   = job.accounts.length
  const success = job.accounts.filter(a => a.status === 'SUCCESS').length
  const failed  = job.accounts.filter(a => a.status === 'FAILED').length
  const running = job.accounts.filter(a => a.status === 'RUNNING').length
  const pending = job.accounts.filter(a => a.status === 'PENDING').length

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <button onClick={() => router.push('/migrations')} className="text-xs text-gray-500 hover:text-gray-300 mb-2 flex items-center gap-1">
                ← Back to migrations
              </button>
              <h1 className="text-2xl font-bold text-white">{job.name}</h1>
              <div className="flex items-center gap-3 mt-2">
                <StatusBadge status={job.status} />
                <span className="text-xs text-gray-500">{job.sourceServer.name} → {job.destServer.name}</span>
                <span className="text-xs text-gray-600">Concurrency: {job.concurrency}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {job.status === 'RUNNING' ? (
                <button onClick={handleStop} disabled={actionLoading} className="btn-danger">Stop</button>
              ) : (
                <button onClick={handleStart} disabled={actionLoading} className="btn-success">
                  {['COMPLETED', 'FAILED', 'STOPPED'].includes(job.status) ? 'Retry failed' : 'Start'}
                </button>
              )}
              {job.status !== 'RUNNING' && (
                <button onClick={handleDelete} className="btn-danger">Delete</button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total',   value: total,   color: 'text-white' },
              { label: 'Success', value: success, color: 'text-green-400' },
              { label: 'Failed',  value: failed,  color: 'text-red-400' },
              { label: 'Running', value: running, color: 'text-blue-400' },
              { label: 'Pending', value: pending, color: 'text-gray-400' },
            ].map(s => (
              <div key={s.label} className="card p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span>Progress</span>
                <span>{Math.round(((success + failed) / total) * 100)}% ({success + failed}/{total})</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden flex">
                <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${(success / total) * 100}%` }} />
                <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${(failed / total) * 100}%` }} />
                <div className="bg-blue-500 h-full transition-all duration-500" style={{ width: `${(running / total) * 100}%` }} />
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-600">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Success</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Failed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Running</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-600" />Pending</span>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="card p-4 grid grid-cols-3 gap-6 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Created</p>
              <p className="text-gray-300">{new Date(job.createdAt).toLocaleString('en-US')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Started</p>
              <p className="text-gray-300">{job.startedAt ? new Date(job.startedAt).toLocaleString('en-US') : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Duration</p>
              <p className="text-gray-300">{formatDuration(job.startedAt, job.finishedAt)}</p>
            </div>
          </div>

          {/* Accounts table */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1e1e2e]">
              <h2 className="text-sm font-semibold text-gray-300">Accounts</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Source email</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Dest email</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e2e]">
                {job.accounts.map(account => (
                  <tr key={account.id} className="hover:bg-[#1a1a2e] transition-colors">
                    <td className="px-5 py-3 text-sm text-gray-300 font-mono">{account.sourceEmail}</td>
                    <td className="px-5 py-3 text-sm text-gray-400 font-mono">{account.destEmail}</td>
                    <td className="px-5 py-3"><StatusBadge status={account.status} /></td>
                    <td className="px-5 py-3 text-xs text-gray-500">{formatDuration(account.startedAt, account.finishedAt)}</td>
                    <td className="px-5 py-3">
                      {(account.status !== 'PENDING' && account.status !== 'SKIPPED') && (
                        <button onClick={() => setLogAccount(account)} className="btn-secondary text-xs px-3 py-1.5">
                          {account.status === 'RUNNING' ? '📡 Live log' : '📄 View log'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {logAccount && (
        <LogViewer
          migrationId={id}
          accountId={logAccount.id}
          accountEmail={logAccount.sourceEmail}
          status={logAccount.status}
          onClose={() => setLogAccount(null)}
        />
      )}
    </div>
  )
}
