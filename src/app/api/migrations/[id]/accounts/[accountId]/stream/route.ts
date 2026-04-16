import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createReadStream, existsSync, statSync, watch, FSWatcher } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const LOG_DIR = process.env.LOG_DIR || '/shared/logs'

const isFinalStatus = (s: string) => s !== 'RUNNING' && s !== 'PENDING'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { accountId } = await params
  const encoder = new TextEncoder()
  const logPath = path.join(LOG_DIR, `${accountId}.log`)

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let watcher: FSWatcher | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let offset = 0
      let pendingChunk = ''
      let draining = false

      const send = (line: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`))
        } catch {
          closed = true
        }
      }

      const cleanup = () => {
        if (watcher) { try { watcher.close() } catch {}; watcher = null }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }

      const sendDone = () => {
        if (closed) return
        closed = true
        cleanup()
        try {
          controller.enqueue(encoder.encode('data: __done__\n\n'))
          controller.close()
        } catch { /* client disconnected */ }
      }

      const drainFile = () =>
        new Promise<void>((res) => {
          if (closed || draining) return res()
          if (!existsSync(logPath)) return res()
          let stats
          try { stats = statSync(logPath) } catch { return res() }
          if (stats.size <= offset) return res()
          draining = true
          const rs = createReadStream(logPath, { start: offset, end: stats.size - 1 })
          rs.on('data', (chunk) => {
            pendingChunk += chunk.toString()
            let idx
            while ((idx = pendingChunk.indexOf('\n')) !== -1) {
              const line = pendingChunk.slice(0, idx).replace(/\r/g, '')
              pendingChunk = pendingChunk.slice(idx + 1)
              if (line.length > 0) send(line)
            }
          })
          const finish = () => {
            offset = stats.size
            draining = false
            res()
          }
          rs.on('end', finish)
          rs.on('error', finish)
        })

      // 1. Determine starting state
      const account = await prisma.migrationAccount.findUnique({
        where: { id: accountId },
        select: { status: true },
      })
      if (!account) { sendDone(); return }

      // 2. Drain existing file content (or fall back to DB for old jobs without a file)
      if (existsSync(logPath)) {
        await drainFile()
      } else {
        const logs = await prisma.migrationLog.findMany({
          where: { accountId },
          orderBy: { createdAt: 'asc' },
          select: { line: true },
        })
        logs.forEach(l => send(l.line))
      }

      // 3. If account already finished, close immediately
      if (isFinalStatus(account.status)) {
        sendDone()
        return
      }

      // 4. Stay open: tail file + poll account status
      try {
        if (existsSync(logPath)) {
          watcher = watch(logPath, () => { drainFile().catch(() => {}) })
        }
      } catch { /* watch may not be supported, fall back to polling */ }

      pollTimer = setInterval(async () => {
        try {
          // (Re-)attach watcher once the file appears
          if (!watcher && existsSync(logPath)) {
            try { watcher = watch(logPath, () => { drainFile().catch(() => {}) }) } catch {}
          }
          await drainFile()
          const a = await prisma.migrationAccount.findUnique({
            where: { id: accountId },
            select: { status: true },
          })
          if (!a || isFinalStatus(a.status)) {
            await drainFile()
            sendDone()
          }
        } catch (e) {
          console.error('SSE poll error:', e)
        }
      }, 1000)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
