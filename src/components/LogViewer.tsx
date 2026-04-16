'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  migrationId: string
  accountId: string
  accountEmail: string
  status: string
  onClose: () => void
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function colorLine(line: string): { text: string; className: string } {
  const text = stripAnsi(line)
  if (text.includes('Transfer completed') || text.includes('Exiting with success') || text.toLowerCase().includes('success')) {
    return { text, className: 'text-green-400' }
  }
  if (text.includes('Error') || text.includes('error') || text.includes('failed') || text.includes('Failed')) {
    return { text, className: 'text-red-400' }
  }
  if (text.includes('Warning') || text.includes('warning') || text.startsWith('++')) {
    return { text, className: 'text-yellow-400' }
  }
  if (text.startsWith('Host') || text.startsWith('User') || text.startsWith('Auth')) {
    return { text, className: 'text-blue-300' }
  }
  return { text, className: 'text-gray-300' }
}

export function LogViewer({ migrationId, accountId, accountEmail, status, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [done, setDone] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    setLines([])
    setDone(false)
    setConnected(false)

    const es = new EventSource(`/api/migrations/${migrationId}/accounts/${accountId}/stream`)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onmessage = (e) => {
      const data = e.data as string
      if (data === '__done__') {
        setDone(true)
        es.close()
        return
      }
      setLines(prev => [...prev, data])
    }
    es.onerror = () => {
      setConnected(false)
      es.close()
    }
  }, [migrationId, accountId])

  useEffect(() => {
    connect()
    return () => { esRef.current?.close() }
  }, [connect])

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAutoScroll(atBottom)
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(lines.map(stripAnsi).join('\n'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl h-[80vh] card flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e] shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${connected && !done ? 'bg-blue-400 pulse-dot' : done ? 'bg-gray-500' : 'bg-yellow-400'}`} />
            <span className="text-sm font-medium text-gray-200">{accountEmail}</span>
            <span className="text-xs text-gray-500">
              {connected && !done ? 'Live' : done ? 'Finished' : 'Connecting...'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyToClipboard} className="btn-secondary text-xs px-3 py-1.5" title="Copy to clipboard">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </button>
            {!autoScroll && (
              <button
                onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                ↓ Bottom
              </button>
            )}
            <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">Close</button>
          </div>
        </div>

        {/* Log area */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto bg-[#07070e] p-4 font-mono"
        >
          {lines.length === 0 && !done && (
            <p className="text-gray-600 text-xs">Waiting for output...</p>
          )}
          {lines.map((line, i) => {
            const { text, className } = colorLine(line)
            return (
              <div key={i} className={`log-line whitespace-pre-wrap break-all ${className}`}>
                {text}
              </div>
            )
          })}
          {done && lines.length > 0 && (
            <div className="log-line text-gray-600 mt-2">— End of log —</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#1e1e2e] flex items-center justify-between text-xs text-gray-500 shrink-0">
          <span>{lines.length} lines</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="rounded border-gray-700"
            />
            Auto-scroll
          </label>
        </div>
      </div>
    </div>
  )
}
