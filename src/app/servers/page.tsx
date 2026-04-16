'use client'

import { useEffect, useState } from 'react'
import { Nav } from '@/components/Nav'

interface Server {
  id: string
  name: string
  host: string
  port: number
  ssl: boolean
  authMech: string | null
  preset: string | null
}

const PRESETS = [
  { value: 'IONOS',    label: 'IONOS',            host: 'imap.ionos.de',            port: 993, ssl: true },
  { value: 'GMAIL',   label: 'Gmail',             host: 'imap.gmail.com',           port: 993, ssl: true },
  { value: 'OUTLOOK', label: 'Outlook / Office 365', host: 'outlook.office365.com', port: 993, ssl: true },
  { value: 'GMX',     label: 'GMX',               host: 'imap.gmx.net',             port: 993, ssl: true },
  { value: 'WEBDE',   label: 'Web.de',            host: 'imap.web.de',              port: 993, ssl: true },
  { value: 'STRATO',  label: 'Strato',            host: 'imap.strato.de',           port: 993, ssl: true },
  { value: 'MIDWIVE', label: 'MidWive',           host: 'mail.midwive.de',          port: 993, ssl: true },
  { value: 'CUSTOM',  label: 'Custom',            host: '',                         port: 993, ssl: true },
]

const presetColors: Record<string, string> = {
  IONOS:   'bg-blue-600/20 text-blue-300 border-blue-600/30',
  GMAIL:   'bg-red-600/20 text-red-300 border-red-600/30',
  OUTLOOK: 'bg-cyan-600/20 text-cyan-300 border-cyan-600/30',
  GMX:     'bg-purple-600/20 text-purple-300 border-purple-600/30',
  WEBDE:   'bg-yellow-600/20 text-yellow-300 border-yellow-600/30',
  STRATO:  'bg-orange-600/20 text-orange-300 border-orange-600/30',
  MIDWIVE: 'bg-green-600/20 text-green-300 border-green-600/30',
  CUSTOM:  'bg-gray-700 text-gray-300 border-gray-600',
}

const emptyForm = { name: '', host: '', port: 993, ssl: true, authMech: '', preset: 'CUSTOM' }

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => fetch('/api/servers').then(r => r.json()).then(setServers)
  useEffect(() => { load() }, [])

  const applyPreset = (presetValue: string) => {
    const preset = PRESETS.find(p => p.value === presetValue)
    if (!preset) return
    setForm(f => ({ ...f, preset: presetValue, host: preset.host || f.host, port: preset.port, ssl: preset.ssl }))
  }

  const openAdd = () => { setEditId(null); setForm(emptyForm); setError(''); setShowForm(true) }
  const openEdit = (s: Server) => {
    setEditId(s.id)
    setForm({ name: s.name, host: s.host, port: s.port, ssl: s.ssl, authMech: s.authMech ?? '', preset: s.preset ?? 'CUSTOM' })
    setError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      const res = await fetch(editId ? `/api/servers/${editId}` : '/api/servers', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to save'); return }
      await load(); setShowForm(false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this server?')) return
    await fetch(`/api/servers/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">Servers</h1>
              <p className="text-gray-500 text-sm mt-0.5">Manage your IMAP servers</p>
            </div>
            <button onClick={openAdd} className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add server
            </button>
          </div>

          {servers.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-gray-700 text-4xl mb-4">🖥️</div>
              <p className="text-gray-400 text-sm">No servers configured yet.</p>
              <button onClick={openAdd} className="btn-primary mt-4 mx-auto">Add your first server</button>
            </div>
          ) : (
            <div className="grid gap-3">
              {servers.map(s => (
                <div key={s.id} className="card px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-lg bg-[#1a1a2e] flex items-center justify-center text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-100">{s.name}</span>
                        {s.preset && (
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${presetColors[s.preset] ?? presetColors.CUSTOM}`}>
                            {PRESETS.find(p => p.value === s.preset)?.label ?? s.preset}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {s.host}:{s.port} · {s.ssl ? 'SSL/TLS' : 'No SSL'}
                        {s.authMech && ` · Auth: ${s.authMech}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(s)} className="btn-secondary text-xs px-3 py-1.5">Edit</button>
                    <button onClick={() => handleDelete(s.id)} className="btn-danger text-xs px-3 py-1.5">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-white mb-5">
              {editId ? 'Edit server' : 'Add server'}
            </h2>

            <div className="space-y-4">
              {error && <div className="bg-red-600/10 border border-red-600/20 rounded-lg px-4 py-2 text-red-400 text-sm">{error}</div>}

              <div>
                <label className="label">Preset template</label>
                <select value={form.preset} onChange={e => applyPreset(e.target.value)} className="input">
                  {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="e.g. IONOS Source" />
              </div>

              <div>
                <label className="label">IMAP host *</label>
                <input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} className="input" placeholder="imap.example.com" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Port</label>
                  <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} className="input" />
                </div>
                <div>
                  <label className="label">Auth mechanism</label>
                  <input value={form.authMech} onChange={e => setForm(f => ({ ...f, authMech: e.target.value }))} className="input" placeholder="e.g. PLAIN" />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.ssl} onChange={e => setForm(f => ({ ...f, ssl: e.target.checked }))} className="rounded border-gray-700 bg-gray-900 text-blue-600" />
                <span className="text-sm text-gray-300">Enable SSL/TLS</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save server'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
