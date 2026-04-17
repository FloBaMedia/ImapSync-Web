import { connect as netConnect, type Socket } from 'net'
import { connect as tlsConnect } from 'tls'

export interface ImapTestParams {
  host: string
  port: number
  ssl: boolean
  user: string
  pass: string
  timeoutMs?: number
}

export interface ImapTestResult {
  ok: boolean
  error?: string
}

// Minimal IMAP LOGIN check. Connects, waits for greeting,
// sends LOGIN and reports OK / NO / BAD. No external deps.
export function testImapLogin({
  host, port, ssl, user, pass, timeoutMs = 15000,
}: ImapTestParams): Promise<ImapTestResult> {
  return new Promise(resolve => {
    let buffer = ''
    let stage: 'greeting' | 'login' | 'done' = 'greeting'
    let settled = false

    const socket: Socket = ssl
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false })
      : netConnect({ host, port })

    const finish = (result: ImapTestResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.end() } catch { /* socket already closed */ }
      try { socket.destroy() } catch { /* socket already destroyed */ }
      resolve(result)
    }

    const timer = setTimeout(() => finish({ ok: false, error: 'Connection timed out' }), timeoutMs)
    socket.setTimeout(timeoutMs)

    socket.on('error', err => finish({ ok: false, error: err.message }))
    socket.on('timeout', () => finish({ ok: false, error: 'Connection timed out' }))
    socket.on('close', () => { if (!settled) finish({ ok: false, error: 'Connection closed before login completed' }) })

    const send = (line: string) => socket.write(line + '\r\n')
    const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (stage === 'greeting') {
          if (/^\* (OK|PREAUTH)\b/i.test(line)) {
            stage = 'login'
            send(`a001 LOGIN "${escape(user)}" "${escape(pass)}"`)
          } else if (/^\* BYE\b/i.test(line)) {
            const msg = line.replace(/^\* BYE\s*/i, '').trim()
            finish({ ok: false, error: msg || 'Server rejected the connection' })
            return
          }
        } else if (stage === 'login') {
          if (/^a001 OK\b/i.test(line)) {
            stage = 'done'
            send('a002 LOGOUT')
            finish({ ok: true })
            return
          } else if (/^a001 (NO|BAD)\b/i.test(line)) {
            const msg = line.replace(/^a001 (?:NO|BAD)\s*/i, '').trim()
            finish({ ok: false, error: msg || 'Authentication failed' })
            return
          }
        }
      }
    })
  })
}
