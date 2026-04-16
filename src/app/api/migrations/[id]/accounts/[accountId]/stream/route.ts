import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOrCreateEmitter } from '@/lib/events'
import { isAccountRunning } from '@/lib/imapsync'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { accountId } = await params
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const send = (data: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { closed = true }
      }

      const sendDone = () => {
        if (closed) return
        closed = true
        try {
          controller.enqueue(encoder.encode('data: __done__\n\n'))
          controller.close()
        } catch { /* client disconnected */ }
      }

      // Subscribe to live events BEFORE loading history to avoid missing events
      const running = isAccountRunning(accountId)
      let onLog: ((line: string) => void) | null = null
      let onDone: (() => void) | null = null

      if (running) {
        const ee = getOrCreateEmitter(accountId)
        onLog = (line: string) => send(line)
        onDone = () => {
          ee.off('log', onLog!)
          sendDone()
        }
        ee.on('log', onLog)
        ee.once('done', onDone)
      }

      // Send historical logs from DB
      prisma.migrationLog
        .findMany({
          where: { accountId },
          orderBy: { createdAt: 'asc' },
          select: { line: true },
        })
        .then(logs => {
          logs.forEach(l => send(l.line))

          // If not (or no longer) running → close
          if (!running || !isAccountRunning(accountId)) {
            if (running) {
              const ee = getOrCreateEmitter(accountId)
              if (onLog) ee.off('log', onLog)
              if (onDone) ee.off('done', onDone)
            }
            sendDone()
          }
          // else: stay open and wait for the live 'done' event
        })
        .catch(err => {
          console.error('SSE error:', err)
          sendDone()
        })
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
