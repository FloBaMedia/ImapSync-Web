'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Nav } from '@/components/Nav'

interface Server { id: string; name: string; host: string; preset: string | null }
interface AccountOptions { subfolder2?: string; exclude?: string; regextrans2?: string; extraArgs?: string }
interface SideTestResult { ok: boolean; error?: string }
interface AccountRow {
  id?: string                  // existing rows have an id; new rows don't
  sourceEmail: string
  sourcePass: string           // blank for existing rows = keep current
  destEmail: string
  destPass: string             // blank for existing rows = keep current
  options?: AccountOptions
  expanded?: boolean
  testing?: boolean
  testResult?: { source: SideTestResult; dest: SideTestResult }
}

const ACCOUNT_OVERRIDABLE: Array<[keyof AccountOptions, string, string]> = [
  ['subfolder2',  '--subfolder2',  'e.g. Archive — overrides job default'],
  ['exclude',     '--exclude',     'Regex of folders to skip for this account'],
  ['regextrans2', '--regextrans2', 'One s### rule per line'],
  ['extraArgs',   'Extra args',    'Appended to imapsync command'],
]

const emptyOptions = {
  ssl1: true, ssl2: true, automap: true, addheader: true,
  syncinternaldates: true, useuid: true,
  subfolder2: '', exclude: '',
  regextrans2: '', extraArgs: '',
}

export default function EditMigrationPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [servers, setServers] = useState<Server[]>([])
  const [name, setName] = useState('')
  const [sourceServerId, setSourceServerId] = useState('')
  const [destServerId, setDestServerId] = useState('')
  const [concurrency, setConcurrency] = useState(1)
  const [options, setOptions] = useState(emptyOptions)
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [saving, setSaving] = useState(false)
  const [startMode, setStartMode] = useState<'now' | 'scheduled' | 'queued' | 'draft'>('draft')
  const [scheduledAt, setScheduledAt] = useState('')
  const [queueGroup, setQueueGroup] = useState('')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'accounts' | 'options'>('accounts')

  useEffect(() => {
    const load = async () => {
      const [serversRes, jobRes] = await Promise.all([
        fetch('/api/servers').then(r => r.json()),
        fetch(`/api/migrations/${id}`).then(r => r.json()),
      ])
      setServers(serversRes)
      if (jobRes.error) { setError(jobRes.error); setLoading(false); return }
      if (jobRes.status !== 'PENDING') {
        setError('This job is not a draft and cannot be edited.')
        setLoading(false)
        return
      }
      setName(jobRes.name)
      setSourceServerId(jobRes.sourceServerId)
      setDestServerId(jobRes.destServerId)
      setConcurrency(jobRes.concurrency)
      setOptions({ ...emptyOptions, ...(jobRes.options ?? {}) })
      setAccounts((jobRes.accounts ?? []).map((a: { id: string; sourceEmail: string; destEmail: string; options: AccountOptions | null }) => ({
        id: a.id,
        sourceEmail: a.sourceEmail,
        sourcePass: '',
        destEmail: a.destEmail,
        destPass: '',
        options: a.options ?? undefined,
      })))
      if (jobRes.scheduledAt) {
        setStartMode(jobRes.queueGroup ? 'queued' : 'scheduled')
        setScheduledAt(new Date(jobRes.scheduledAt).toISOString().slice(0, 16))
      } else if (jobRes.queueGroup) {
        setStartMode('queued')
      }
      if (jobRes.queueGroup) setQueueGroup(jobRes.queueGroup)
      setLoading(false)
    }
    load()
  }, [id])

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = (ev.target?.result as string).replace(/\r/g, '')
      const rows: AccountRow[] = []
      for (const line of text.split('\n')) {
        const cleaned = line.replace(/"/g, '').trim()
        if (!cleaned || cleaned.startsWith('#')) continue
        const parts = cleaned.split(';')
        if (parts.length >= 4) {
          rows.push({ sourceEmail: parts[0].trim(), sourcePass: parts[1].trim(), destEmail: parts[2].trim(), destPass: parts[3].trim() })
        }
      }
      if (rows.length > 0) setAccounts(prev => [...prev, ...rows])
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const addRow = () => setAccounts(a => [...a, { sourceEmail: '', sourcePass: '', destEmail: '', destPass: '' }])
  const removeRow = (i: number) => setAccounts(a => a.filter((_, idx) => idx !== i))
  const updateRow = (i: number, field: 'sourceEmail' | 'sourcePass' | 'destEmail' | 'destPass', value: string) =>
    setAccounts(a => a.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  const toggleExpand = (i: number) =>
    setAccounts(a => a.map((row, idx) => idx === i ? { ...row, expanded: !row.expanded } : row))
  const updateOption = (i: number, key: keyof AccountOptions, value: string) =>
    setAccounts(a => a.map((row, idx) => {
      if (idx !== i) return row
      const next = { ...(row.options ?? {}), [key]: value }
      Object.keys(next).forEach(k => { if (!(next as Record<string, string>)[k]) delete (next as Record<string, string>)[k] })
      return { ...row, options: next }
    }))
  const countOverrides = (opts?: AccountOptions) =>
    opts ? Object.values(opts).filter(v => v && String(v).trim()).length : 0

  const testRow = async (i: number) => {
    const row = accounts[i]
    if (!sourceServerId || !destServerId) { setError('Pick source and destination servers before testing.'); return }
    if (!row.sourceEmail || !row.destEmail) { setError('Both emails are required.'); return }
    setError('')
    setAccounts(a => a.map((r, idx) => idx === i ? { ...r, testing: true, testResult: undefined } : r))

    const callTest = (payload: Record<string, unknown>) =>
      fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json() as Promise<SideTestResult>)
        .catch(e => ({ ok: false, error: (e as Error).message }))

    // For existing rows: blank password = use stored creds via accountId
    // For new/edited rows: send the typed password
    const sourcePayload = row.sourcePass
      ? { serverId: sourceServerId, email: row.sourceEmail, password: row.sourcePass }
      : row.id
        ? { accountId: row.id, side: 'source' }
        : null
    const destPayload = row.destPass
      ? { serverId: destServerId, email: row.destEmail, password: row.destPass }
      : row.id
        ? { accountId: row.id, side: 'dest' }
        : null

    if (!sourcePayload || !destPayload) {
      setError('New rows need both passwords filled in before testing.')
      setAccounts(a => a.map((r, idx) => idx === i ? { ...r, testing: false } : r))
      return
    }

    const [source, dest] = await Promise.all([callTest(sourcePayload), callTest(destPayload)])
    setAccounts(a => a.map((r, idx) => idx === i ? { ...r, testing: false, testResult: { source, dest } } : r))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!sourceServerId || !destServerId) { setError('Please select a source and destination server.'); return }
    if (sourceServerId === destServerId) { setError('Source and destination servers must be different.'); return }

    // Existing rows: keep if email present (passwords may be blank to keep current)
    // New rows: require all four fields
    const validAccounts = accounts.filter(a => {
      if (!a.sourceEmail || !a.destEmail) return false
      if (a.id) return true
      return Boolean(a.sourcePass && a.destPass)
    }).map(a => ({
      id: a.id,
      sourceEmail: a.sourceEmail,
      sourcePass: a.sourcePass,
      destEmail: a.destEmail,
      destPass: a.destPass,
      options: countOverrides(a.options) > 0 ? a.options : null,
    }))

    if (validAccounts.length === 0) { setError('At least one complete account is required.'); return }
    if (startMode === 'scheduled' && !scheduledAt) { setError('Pick a date/time for the scheduled start.'); return }
    if (startMode === 'queued' && !queueGroup.trim()) { setError('Enter a queue name.'); return }

    setSaving(true)
    const res = await fetch(`/api/migrations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, sourceServerId, destServerId, concurrency, options,
        accounts: validAccounts,
        startMode,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        queueGroup: queueGroup.trim() || null,
      }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to save changes')
      setSaving(false)
      return
    }
    router.push(`/migrations/${id}`)
  }

  if (loading) return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 flex items-center justify-center text-gray-600">Loading…</main>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <button onClick={() => router.push(`/migrations/${id}`)} className="text-xs text-gray-500 hover:text-gray-300 mb-2 flex items-center gap-1">
              ← Back to migration
            </button>
            <h1 className="text-2xl font-bold text-white">Edit draft</h1>
            <p className="text-gray-500 text-sm mt-0.5">Adjust this draft before starting it</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="bg-red-600/10 border border-red-600/20 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}

            {/* Basic settings */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">Basic settings</h2>

              <div>
                <label className="label">Migration name</label>
                <input value={name} onChange={e => setName(e.target.value)} className="input" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Source server *</label>
                  <select value={sourceServerId} onChange={e => setSourceServerId(e.target.value)} className="input">
                    <option value="">— Select server —</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Destination server *</label>
                  <select value={destServerId} onChange={e => setDestServerId(e.target.value)} className="input">
                    <option value="">— Select server —</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Concurrency (parallel accounts)</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={1} max={10} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} className="flex-1 accent-blue-500" />
                  <span className="text-sm font-mono w-6 text-center text-blue-400">{concurrency}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="card overflow-hidden">
              <div className="flex border-b border-[#1e1e2e]">
                <button type="button" onClick={() => setActiveTab('accounts')} className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'accounts' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}>
                  Accounts ({accounts.filter(a => a.sourceEmail).length})
                </button>
                <button type="button" onClick={() => setActiveTab('options')} className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'options' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}>
                  imapsync options
                </button>
              </div>

              {activeTab === 'accounts' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Existing rows: leave password fields blank to keep the stored password.</p>
                    <label className="btn-secondary cursor-pointer text-xs px-3 py-1.5">
                      Import CSV
                      <input type="file" accept=".csv,.txt" onChange={handleCsvImport} className="hidden" />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2 px-1">
                      {['Source email', 'Source password', 'Dest email', 'Dest password'].map(h => (
                        <span key={h} className="text-xs text-gray-600">{h}</span>
                      ))}
                    </div>
                    {accounts.map((row, i) => {
                      const overrides = countOverrides(row.options)
                      const isExisting = Boolean(row.id)
                      return (
                        <div key={row.id ?? `new-${i}`} className="space-y-2">
                          <div className="grid grid-cols-4 gap-2 items-center">
                            <input value={row.sourceEmail} onChange={e => updateRow(i, 'sourceEmail', e.target.value)} className="input text-xs" placeholder="user@source.com" />
                            <input type="password" value={row.sourcePass} onChange={e => updateRow(i, 'sourcePass', e.target.value)} className="input text-xs" placeholder={isExisting ? 'Keep current' : 'Password'} />
                            <input value={row.destEmail} onChange={e => updateRow(i, 'destEmail', e.target.value)} className="input text-xs" placeholder="user@dest.com" />
                            <div className="flex gap-1.5">
                              <input type="password" value={row.destPass} onChange={e => updateRow(i, 'destPass', e.target.value)} className="input text-xs" placeholder={isExisting ? 'Keep current' : 'Password'} />
                              <button type="button" onClick={() => testRow(i)} disabled={row.testing} title="Test both IMAP logins" className="text-xs px-2 shrink-0 rounded border border-gray-700 text-gray-500 hover:text-blue-400 disabled:opacity-50">
                                {row.testing ? '…' : '⚡'}
                              </button>
                              <button type="button" onClick={() => toggleExpand(i)} title="Per-account options" className={`text-xs px-2 shrink-0 rounded border ${overrides > 0 ? 'border-purple-600/40 text-purple-400 bg-purple-600/10' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                                ⚙{overrides > 0 && <span className="ml-1">{overrides}</span>}
                              </button>
                              {accounts.length > 1 && (
                                <button type="button" onClick={() => removeRow(i)} className="text-gray-600 hover:text-red-400 px-1 shrink-0">✕</button>
                              )}
                            </div>
                          </div>
                          {row.testResult && (
                            <div className="ml-2 pl-3 border-l-2 border-blue-600/30 py-1.5 space-y-1 bg-[#0e0e1a] rounded-r text-xs">
                              <div className={row.testResult.source.ok ? 'text-green-400' : 'text-red-400'}>
                                {row.testResult.source.ok ? '✓' : '✗'} Source login{row.testResult.source.error ? ` — ${row.testResult.source.error}` : ' OK'}
                              </div>
                              <div className={row.testResult.dest.ok ? 'text-green-400' : 'text-red-400'}>
                                {row.testResult.dest.ok ? '✓' : '✗'} Destination login{row.testResult.dest.error ? ` — ${row.testResult.dest.error}` : ' OK'}
                              </div>
                            </div>
                          )}
                          {row.expanded && (
                            <div className="ml-2 pl-3 border-l-2 border-purple-600/30 py-2 space-y-2 bg-[#0e0e1a] rounded-r">
                              <p className="text-xs text-gray-500">Per-account overrides — leave empty to use the job&apos;s default.</p>
                              {ACCOUNT_OVERRIDABLE.map(([key, label, placeholder]) => (
                                <div key={key} className="grid grid-cols-[120px_1fr] gap-2 items-start">
                                  <label className="text-xs text-gray-400 font-mono pt-1.5">{label}</label>
                                  {key === 'regextrans2' ? (
                                    <textarea value={row.options?.[key] ?? ''} onChange={e => updateOption(i, key, e.target.value)} className="input text-xs font-mono" rows={2} placeholder={placeholder} />
                                  ) : (
                                    <input value={row.options?.[key] ?? ''} onChange={e => updateOption(i, key, e.target.value)} className="input text-xs" placeholder={placeholder} />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <button type="button" onClick={addRow} className="btn-secondary text-xs">+ Add row</button>
                </div>
              )}

              {activeTab === 'options' && (
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      {([['ssl1', '--ssl1 (source SSL)'], ['ssl2', '--ssl2 (dest SSL)'], ['automap', '--automap'], ['addheader', '--addheader']] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={(options as Record<string, unknown>)[key] as boolean} onChange={e => setOptions(o => ({ ...o, [key]: e.target.checked }))} className="rounded border-gray-700 bg-gray-900 text-blue-600" />
                          <span className="text-sm text-gray-300 font-mono">{label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {([['syncinternaldates', '--syncinternaldates'], ['useuid', '--useuid']] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={(options as Record<string, unknown>)[key] as boolean} onChange={e => setOptions(o => ({ ...o, [key]: e.target.checked }))} className="rounded border-gray-700 bg-gray-900 text-blue-600" />
                          <span className="text-sm text-gray-300 font-mono">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label">--subfolder2 (destination subfolder prefix)</label>
                    <input value={options.subfolder2} onChange={e => setOptions(o => ({ ...o, subfolder2: e.target.value }))} className="input" placeholder="e.g. Archive (empty = disabled)" />
                  </div>

                  <div>
                    <label className="label">--exclude (regex for folders to skip)</label>
                    <input value={options.exclude} onChange={e => setOptions(o => ({ ...o, exclude: e.target.value }))} className="input" placeholder="(?i)Spam|Trash|Junk" />
                  </div>

                  <div>
                    <label className="label">--regextrans2 (folder renaming rules, one per line)</label>
                    <textarea value={options.regextrans2} onChange={e => setOptions(o => ({ ...o, regextrans2: e.target.value }))} className="input font-mono text-xs" rows={3} placeholder={`s#\\[Gmail\\]/Sent Mail#Sent#\ns#\\[Gmail\\]/Trash#Trash#`} />
                  </div>

                  <div>
                    <label className="label">Extra arguments (passed directly to imapsync)</label>
                    <input value={options.extraArgs} onChange={e => setOptions(o => ({ ...o, extraArgs: e.target.value }))} className="input font-mono text-xs" placeholder="--dry --justlogin" />
                  </div>
                </div>
              )}
            </div>

            {/* Start mode */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">When to start</h2>
              <div className="space-y-2">
                {([
                  ['now', 'Start immediately', 'Run as soon as you save'],
                  ['scheduled', 'Schedule for a specific time', 'Runner picks it up automatically at the chosen time'],
                  ['queued', 'Add to a queue', 'Runs sequentially with other jobs sharing the same queue name'],
                  ['draft', 'Keep as draft', 'Stay unstarted — start manually later'],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-3 cursor-pointer p-2 rounded hover:bg-[#1a1a2e]">
                    <input type="radio" name="startMode" value={value} checked={startMode === value} onChange={() => setStartMode(value)} className="mt-1 accent-blue-500" />
                    <div>
                      <p className="text-sm text-gray-200">{label}</p>
                      <p className="text-xs text-gray-500">{hint}</p>
                    </div>
                  </label>
                ))}
              </div>

              {startMode === 'scheduled' && (
                <div>
                  <label className="label">Start at</label>
                  <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="input" />
                </div>
              )}

              {(startMode === 'queued' || startMode === 'scheduled') && (
                <div>
                  <label className="label">Queue name {startMode === 'scheduled' && <span className="text-gray-600">(optional — leave empty for parallel)</span>}</label>
                  <input value={queueGroup} onChange={e => setQueueGroup(e.target.value)} className="input" placeholder="e.g. nightly-batch" />
                  <p className="text-xs text-gray-500 mt-1">Jobs sharing the same queue name run one after another.</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => router.push(`/migrations/${id}`)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : startMode === 'now' ? 'Save & start' : startMode === 'scheduled' ? 'Save & schedule' : startMode === 'queued' ? 'Save & queue' : 'Save draft'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
