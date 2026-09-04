'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compareMailboxes } from '@/lib/mailbox-compare'
import {
  buildFolderTree,
  countMessages,
  filterTree,
  formatCount,
  type FolderNode,
} from '@/lib/mailbox-tree'
import type {
  CompareRow,
  CompareStatus,
  MailboxCompareResult,
  MailboxFolder,
  MailboxListing,
  MailboxMapOptions,
} from '@/lib/mailbox-types'

type Tab = 'browse' | 'compare'
type Filter = 'all' | 'problems' | 'matched' | 'missing' | 'mismatch' | 'extra' | 'excluded'

interface StoredProps {
  mode: 'stored'
  migrationId: string
  accountId: string
  defaultTab?: Tab
}

interface AdhocSide {
  serverId: string
  email: string
  password?: string
  accountId?: string
}

interface AdhocProps {
  mode: 'adhoc'
  source: AdhocSide
  dest: AdhocSide
  options: MailboxMapOptions
}

type Props = (StoredProps | AdhocProps) & {
  variant: 'overlay' | 'page'
  onClose?: () => void
}

interface Payload {
  source: MailboxListing
  dest: MailboxListing
  compare: MailboxCompareResult | null
  options?: MailboxMapOptions
  account?: { sourceEmail: string; destEmail: string; status: string }
}

const STATUS_META: Record<CompareStatus, { label: string; pip: string; text: string; rail: string }> = {
  matched:  { label: 'Match',     pip: 'bg-emerald-400', text: 'text-emerald-300', rail: 'bg-emerald-500/40' },
  mismatch: { label: 'Count gap', pip: 'bg-amber-400',   text: 'text-amber-300',   rail: 'bg-amber-400/70' },
  missing:  { label: 'Missing',   pip: 'bg-red-400',     text: 'text-red-300',     rail: 'bg-red-500/50' },
  extra:    { label: 'Only dest', pip: 'bg-sky-400',     text: 'text-sky-300',     rail: 'bg-sky-500/40' },
  excluded: { label: 'Skipped',   pip: 'bg-zinc-500',    text: 'text-zinc-400',    rail: 'bg-zinc-600/50' },
}

function FolderGlyph({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l1.8 1.8H19.5A1.5 1.5 0 0 1 21 9.3v8.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M4.2 2.1 8.4 6 4.2 9.9V2.1Z" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function ReloadGlyph() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 12a8 8 0 0 1-13.7 5.6L4 16M20 4v4h-4M4 20v-4h4" />
    </svg>
  )
}

function TreeRows({
  nodes,
  depth = 0,
  open,
  onToggle,
}: {
  nodes: FolderNode[]
  depth?: number
  open: Set<string>
  onToggle: (path: string) => void
}) {
  return (
    <>
      {nodes.map(node => {
        const hasKids = node.children.length > 0
        const isOpen = open.has(node.folder.fullName)
        const muted = !node.folder.selectable
        return (
          <div key={node.folder.path}>
            <div
              className={`group flex items-center gap-2 py-1.5 pr-3 rounded-md hover:bg-white/[0.03] ${muted ? 'opacity-50' : ''}`}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <button
                type="button"
                className={`w-4 h-4 flex items-center justify-center text-zinc-500 ${hasKids ? 'hover:text-zinc-300' : 'invisible'}`}
                onClick={() => onToggle(node.folder.fullName)}
                aria-expanded={hasKids ? isOpen : undefined}
                aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
              >
                <Chevron open={isOpen} />
              </button>
              <span className="text-zinc-400 group-hover:text-blue-300"><FolderGlyph /></span>
              <span className="flex-1 min-w-0 truncate text-sm text-zinc-200" title={node.folder.fullName}>
                {node.folder.name}
                {node.folder.special && node.folder.special !== 'inbox' && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500">{node.folder.special}</span>
                )}
              </span>
              <span className="tabular-nums text-xs text-zinc-400 w-16 text-right">{formatCount(node.folder.messages)}</span>
              {node.folder.unseen !== null && node.folder.unseen > 0 && (
                <span className="tabular-nums text-[10px] text-blue-400 w-10 text-right">{node.folder.unseen} new</span>
              )}
            </div>
            {hasKids && isOpen && (
              <TreeRows nodes={node.children} depth={depth + 1} open={open} onToggle={onToggle} />
            )}
          </div>
        )
      })}
    </>
  )
}

function MailboxPane({
  title,
  listing,
  loading,
}: {
  title: string
  listing: MailboxListing | null
  loading: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const tree = useMemo(() => {
    if (!listing?.ok) return []
    return filterTree(buildFolderTree(listing.folders), query)
  }, [listing, query])

  useEffect(() => {
    if (!listing?.ok) return
    const next = new Set<string>()
    for (const f of listing.folders) {
      if (f.special === 'inbox' || !f.fullName.includes(f.delimiter || '/')) next.add(f.fullName)
    }
    setOpen(next)
  }, [listing])

  const totals = listing?.ok ? countMessages(listing.folders.filter(f => f.selectable)) : null

  return (
    <section className="flex flex-col min-h-0 bg-[#0e0e18] rounded-xl border border-[#1e1e2e]">
      <header className="px-4 pt-4 pb-3 border-b border-[#1e1e2e]">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          {totals?.known && (
            <p className="text-xs text-zinc-500 tabular-nums">
              {formatCount(totals.messages)} messages
              {totals.unseen > 0 && <span className="text-blue-400"> · {formatCount(totals.unseen)} unseen</span>}
            </p>
          )}
        </div>
        {listing?.email && (
          <p className="text-xs text-zinc-500 mt-0.5 font-mono truncate">{listing.email}{listing.server ? ` · ${listing.server.host}` : ''}</p>
        )}
        <label className="block mt-3">
          <span className="sr-only">Filter folders</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input text-xs"
            placeholder="Filter folders…"
            disabled={loading || !listing?.ok}
          />
        </label>
      </header>
      <div className="flex-1 overflow-auto px-1 py-2">
        {loading && (
          <div className="space-y-2 px-3 py-2" aria-busy="true" aria-label="Loading folders">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-7 rounded-md bg-[#1a1a28] animate-pulse" style={{ marginLeft: (i % 4) * 12 }} />
            ))}
          </div>
        )}
        {!loading && listing && !listing.ok && (
          <p className="px-4 py-6 text-sm text-red-400">{listing.error || 'Could not read this mailbox.'}</p>
        )}
        {!loading && listing?.ok && tree.length === 0 && (
          <p className="px-4 py-6 text-sm text-zinc-500">
            {query ? `No folders match “${query}”.` : 'This mailbox has no folders.'}
          </p>
        )}
        {!loading && listing?.ok && (
          <TreeRows
            nodes={tree}
            open={open}
            onToggle={path => setOpen(prev => {
              const next = new Set(prev)
              if (next.has(path)) next.delete(path)
              else next.add(path)
              return next
            })}
          />
        )}
      </div>
      {listing?.warning && (
        <p className="px-4 py-2 text-[11px] text-amber-400/80 border-t border-[#1e1e2e]">{listing.warning}</p>
      )}
    </section>
  )
}

function CompareRowView({ row }: { row: CompareRow }) {
  const meta = STATUS_META[row.status]
  const srcName = row.source?.fullName
  const destName = row.dest?.fullName ?? (row.status === 'missing' ? row.expectedDestName : undefined)
  return (
    <li className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_72px] gap-2 lg:gap-3 items-center px-3 py-2.5 rounded-lg hover:bg-white/[0.025]">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.pip}`} />
        <FolderGlyph className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className={`truncate text-sm ${row.source ? 'text-zinc-200' : 'text-zinc-600 italic'}`}>
          {srcName ?? (row.status === 'extra' ? 'Not on source' : '—')}
        </span>
        <span className="ml-auto tabular-nums text-xs text-zinc-400 w-14 text-right">
          {row.source ? formatCount(row.source.messages) : ''}
        </span>
      </div>
      <div className="hidden lg:flex items-center justify-center">
        <span className={`h-px w-full ${meta.rail}`} />
      </div>
      <div className="flex items-center gap-2 min-w-0 pl-5 lg:pl-0">
        <FolderGlyph className="w-3.5 h-3.5 text-zinc-500 shrink-0 hidden lg:block" />
        <span className={`truncate text-sm ${row.dest || row.status === 'missing' ? 'text-zinc-200' : 'text-zinc-600 italic'}`}>
          {destName ?? (row.status === 'excluded' ? 'Skipped by exclude' : '—')}
        </span>
        <span className="ml-auto tabular-nums text-xs text-zinc-400 w-14 text-right">
          {row.dest ? formatCount(row.dest.messages) : row.status === 'missing' ? '0' : ''}
        </span>
      </div>
      <div className={`text-xs font-medium ${meta.text} lg:text-right pl-5 lg:pl-0`}>
        {row.status === 'mismatch' && row.messageDelta !== null
          ? `${row.messageDelta > 0 ? '+' : ''}${row.messageDelta}`
          : meta.label}
      </div>
    </li>
  )
}

function CompareView({
  compare,
  sourceOk,
  destOk,
}: {
  compare: MailboxCompareResult | null
  sourceOk: boolean
  destOk: boolean
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  if (!sourceOk || !destOk) {
    return (
      <p className="text-sm text-zinc-400 px-1 py-8">
        Comparison needs a successful listing on both sides. Switch to Browse to see which mailbox failed.
      </p>
    )
  }
  if (!compare) {
    return <p className="text-sm text-zinc-500 px-1 py-8">No comparison available yet.</p>
  }

  const { summary, rows } = compare
  const visible = rows.filter(row => {
    if (filter === 'problems' && (row.status === 'matched' || row.status === 'excluded')) return false
    if (filter !== 'all' && filter !== 'problems' && row.status !== filter) return false
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (row.source?.fullName ?? '').toLowerCase().includes(q)
      || (row.dest?.fullName ?? '').toLowerCase().includes(q)
      || (row.expectedDestName ?? '').toLowerCase().includes(q)
  })

  const problemCount = summary.missing + summary.mismatch + summary.extra
  const transferable = summary.matched + summary.mismatch + summary.missing
  const folderPct = transferable > 0 ? Math.round((summary.matched / transferable) * 100) : 100
  const msgPct = summary.sourceMessages > 0
    ? Math.round((summary.destMatchedMessages / summary.sourceMessages) * 100)
    : 100

  const chips: Array<[Filter, string, number]> = [
    ['all', 'All', rows.length],
    ['problems', 'Problems', problemCount],
    ['matched', 'Match', summary.matched],
    ['mismatch', 'Count gap', summary.mismatch],
    ['missing', 'Missing', summary.missing],
    ['extra', 'Only dest', summary.extra],
    ['excluded', 'Skipped', summary.excluded],
  ]

  return (
    <div className="flex flex-col min-h-0 gap-4">
      <section className="rounded-xl border border-[#1e1e2e] bg-[#0e0e18] px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-lg text-zinc-100 font-semibold tracking-tight">
              {problemCount === 0
                ? 'Every mapped folder is present'
                : `${problemCount} folder${problemCount === 1 ? '' : 's'} need a look`}
            </p>
            <p className="text-sm text-zinc-500 mt-1">
              {formatCount(summary.matched)} of {formatCount(transferable)} folders match
              {' · '}
              {formatCount(summary.destMatchedMessages)} of {formatCount(summary.sourceMessages)} source messages found on destination
            </p>
          </div>
          <div className="text-right tabular-nums">
            <p className="text-2xl font-semibold text-zinc-100">{folderPct}%</p>
            <p className="text-[11px] text-zinc-500">folders · {msgPct}% messages</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 rounded-full bg-[#1a1a28] overflow-hidden flex">
          {summary.matched > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(summary.matched / Math.max(rows.length, 1)) * 100}%` }} />}
          {summary.mismatch > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(summary.mismatch / Math.max(rows.length, 1)) * 100}%` }} />}
          {summary.missing > 0 && <div className="bg-red-500 h-full" style={{ width: `${(summary.missing / Math.max(rows.length, 1)) * 100}%` }} />}
          {summary.extra > 0 && <div className="bg-sky-500 h-full" style={{ width: `${(summary.extra / Math.max(rows.length, 1)) * 100}%` }} />}
          {summary.excluded > 0 && <div className="bg-zinc-600 h-full" style={{ width: `${(summary.excluded / Math.max(rows.length, 1)) * 100}%` }} />}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === id
                ? 'border-blue-500/50 bg-blue-600/15 text-blue-300'
                : 'border-[#2a2a3e] text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label} <span className="tabular-nums text-zinc-500">{count}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input text-xs ml-auto w-full sm:w-56"
          placeholder="Filter by folder name…"
        />
      </div>

      <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_72px] gap-3 px-3 text-[10px] uppercase tracking-wider text-zinc-600">
        <span>Source folder</span>
        <span className="text-center">Map</span>
        <span>Destination folder</span>
        <span className="text-right">Status</span>
      </div>

      <ul className="flex-1 overflow-auto space-y-0.5 min-h-0">
        {visible.length === 0 && (
          <li className="px-3 py-8 text-sm text-zinc-500">No folders in this filter.</li>
        )}
        {visible.map(row => <CompareRowView key={row.id} row={row} />)}
      </ul>
    </div>
  )
}

export function MailboxInspector(props: Props) {
  const [tab, setTab] = useState<Tab>(
    props.mode === 'stored' && props.defaultTab ? props.defaultTab : 'browse',
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState<Payload | null>(null)
  const didInitTab = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props

  const load = useCallback(async () => {
    const current = propsRef.current
    setLoading(true)
    setError('')
    try {
      if (current.mode === 'stored') {
        const res = await fetch(`/api/migrations/${current.migrationId}/accounts/${current.accountId}/mailbox`, {
          method: 'POST',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to read mailboxes')
        setPayload(data)
        if (!didInitTab.current) {
          didInitTab.current = true
          const finished = ['SUCCESS', 'FAILED', 'STOPPED'].includes(data.account?.status)
          setTab(current.defaultTab ?? (finished ? 'compare' : 'browse'))
        }
      } else {
        const sourceBody = current.source.password
          ? { serverId: current.source.serverId, email: current.source.email, password: current.source.password }
          : { accountId: current.source.accountId, side: 'source' as const }
        const destBody = current.dest.password
          ? { serverId: current.dest.serverId, email: current.dest.email, password: current.dest.password }
          : { accountId: current.dest.accountId, side: 'dest' as const }
        const [source, dest] = await Promise.all([
          fetch('/api/imap/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sourceBody) }).then(r => r.json()),
          fetch('/api/imap/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(destBody) }).then(r => r.json()),
        ])
        const compare = source.ok && dest.ok
          ? compareMailboxes(source.folders as MailboxFolder[], dest.folders as MailboxFolder[], dest.delimiter, current.options)
          : null
        setPayload({ source, dest, compare, options: current.options })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (props.variant !== 'overlay') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const title = payload?.account
    ? `${payload.account.sourceEmail} → ${payload.account.destEmail}`
    : props.mode === 'adhoc'
      ? `${props.source.email} → ${props.dest.email}`
      : 'Mailbox browser'

  const inner = (
    <div className={`flex flex-col min-h-0 ${props.variant === 'overlay' ? 'h-full' : 'min-h-[70vh]'}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#1e1e2e] shrink-0">
        <div className="min-w-0">
          <h2 id="mailbox-inspector-title" className="text-sm font-semibold text-zinc-100 truncate">{title}</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {tab === 'browse' ? 'Live folder tree on both servers' : 'Mapped folders and message counts'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[#2a2a3e] overflow-hidden">
            {(['browse', 'compare'] as const).map(id => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={active
                    ? 'px-3 py-1.5 text-xs font-medium capitalize bg-blue-600/20 text-blue-100'
                    : 'px-3 py-1.5 text-xs font-medium capitalize text-zinc-400 hover:text-zinc-200'}
                >
                  {id}
                </button>
              )
            })}
          </div>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs px-3 py-1.5">
            <ReloadGlyph /> {loading ? 'Reading…' : 'Reload'}
          </button>
          {props.variant === 'overlay' && props.onClose && (
            <button type="button" onClick={props.onClose} className="btn-secondary text-xs px-3 py-1.5" aria-label="Close">
              <CloseGlyph />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden p-4">
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {tab === 'browse' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full min-h-[28rem]">
            <MailboxPane title="Source" listing={payload?.source ?? null} loading={loading} />
            <MailboxPane title="Destination" listing={payload?.dest ?? null} loading={loading} />
          </div>
        ) : (
          <div className="h-full overflow-auto">
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-24 rounded-xl bg-[#1a1a28] animate-pulse" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-[#1a1a28] animate-pulse" />
                ))}
              </div>
            ) : (
              <CompareView
                compare={payload?.compare ?? null}
                sourceOk={Boolean(payload?.source?.ok)}
                destOk={Boolean(payload?.dest?.ok)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )

  if (props.variant === 'page') return inner

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="mailbox-inspector-title">
      <div className="w-full max-w-6xl h-[88vh] card flex flex-col overflow-hidden">
        {inner}
      </div>
    </div>
  )
}

export function FolderBrowseButton({
  onClick,
  disabled,
  label = 'Folders',
}: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Browse folders on both servers"
      className="text-xs px-2 shrink-0 rounded border border-gray-700 text-gray-500 hover:text-blue-400 disabled:opacity-50 inline-flex items-center justify-center"
      aria-label={label}
    >
      <FolderGlyph className="w-3.5 h-3.5" />
    </button>
  )
}
