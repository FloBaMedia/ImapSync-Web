'use client'

import { useEffect, useState } from 'react'
import { Nav } from '@/components/Nav'

const BOOL_SETTINGS = [
  { key: 'ssl1',             label: '--ssl1',             desc: 'Enable SSL/TLS for the source server' },
  { key: 'ssl2',             label: '--ssl2',             desc: 'Enable SSL/TLS for the destination server' },
  { key: 'automap',          label: '--automap',          desc: 'Automatically map folders between servers' },
  { key: 'addheader',        label: '--addheader',        desc: 'Add a header to migrated messages' },
  { key: 'syncinternaldates',label: '--syncinternaldates',desc: 'Preserve internal date/time stamps' },
  { key: 'useuid',           label: '--useuid',           desc: 'Use UIDs for consistent synchronization' },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(data => { setSettings(data); setLoading(false) })
  }, [])

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const set = (key: string, value: string) => setSettings(s => ({ ...s, [key]: value }))
  const toggleBool = (key: string) => set(key, settings[key] === 'false' ? 'true' : 'false')
  const isTrue = (key: string) => settings[key] !== 'false'

  if (loading) return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 flex items-center justify-center text-gray-600">Loading...</main>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            <p className="text-gray-500 text-sm mt-0.5">Default imapsync options applied to new migrations</p>
          </div>

          <div className="space-y-6">
            {/* Toggle options */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">Default flags</h2>
              <div className="space-y-3">
                {BOOL_SETTINGS.map(s => (
                  <label key={s.key} className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative mt-0.5 shrink-0">
                      <input type="checkbox" checked={isTrue(s.key)} onChange={() => toggleBool(s.key)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-700 peer-checked:bg-blue-600 rounded-full transition-colors" />
                      <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                    </div>
                    <div>
                      <p className="text-sm font-mono text-gray-200">{s.label}</p>
                      <p className="text-xs text-gray-500">{s.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Folder options */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">Folder configuration</h2>

              <div>
                <label className="label">--subfolder2 (destination subfolder prefix)</label>
                <input value={settings.subfolder2 ?? ''} onChange={e => set('subfolder2', e.target.value)} className="input" placeholder="e.g. Archive (empty = disabled)" />
              </div>

              <div>
                <label className="label">--exclude (regex for folders to skip)</label>
                <input value={settings.exclude ?? ''} onChange={e => set('exclude', e.target.value)} className="input" placeholder="(?i)Spam|Trash|Junk" />
              </div>

              <div>
                <label className="label">--regextrans2 (folder renaming rules, one per line)</label>
                <textarea
                  value={settings.regextrans2 ?? ''}
                  onChange={e => set('regextrans2', e.target.value)}
                  className="input font-mono text-xs"
                  rows={4}
                  placeholder={`s#\\[Gmail\\]/Sent Mail#Sent#\ns#\\[Gmail\\]/Trash#Trash#\ns#\\[Gmail\\]/Spam#Spam#`}
                />
                <p className="text-xs text-gray-600 mt-1">Each line is passed as a separate <code className="text-gray-500">--regextrans2</code> argument.</p>
              </div>
            </div>

            {/* Advanced */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300">Advanced</h2>
              <div>
                <label className="label">Extra arguments (appended to every imapsync call)</label>
                <input
                  value={settings.extraArgs ?? ''}
                  onChange={e => set('extraArgs', e.target.value)}
                  className="input font-mono text-xs"
                  placeholder="--dry --justlogin --maxsize 10000000"
                />
                <p className="text-xs text-gray-600 mt-1">Space-separated imapsync flags. Appended to all migrations.</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              {saved
                ? <span className="text-sm text-green-400">✓ Settings saved</span>
                : <span />
              }
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
