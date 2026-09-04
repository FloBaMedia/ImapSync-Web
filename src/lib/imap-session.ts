import { connect as netConnect, type Socket } from 'net'
import { connect as tlsConnect } from 'tls'
import { decodeModifiedUtf7 } from './imap-utf7'
import { detectSpecial } from './mailbox-compare'
import type { MailboxFolder, MailboxListing } from './mailbox-types'

export interface ImapConnectParams {
  host: string
  port: number
  ssl: boolean
  user: string
  pass: string
  timeoutMs?: number
}

const STATUS_BATCH = 20
const MAX_STATUS_FOLDERS = 400

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function quoteMailbox(path: string): string {
  return `"${escapeQuoted(path)}"`
}

function parseImapString(input: string, start: number): { value: string; next: number } | null {
  if (start >= input.length) return null
  if (input[start] === '"') {
    let i = start + 1
    let value = ''
    while (i < input.length) {
      if (input[i] === '\\' && i + 1 < input.length) {
        value += input[i + 1]
        i += 2
        continue
      }
      if (input[i] === '"') return { value, next: i + 1 }
      value += input[i]
      i++
    }
    return null
  }
  if (input.slice(start, start + 3).toUpperCase() === 'NIL') {
    return { value: '', next: start + 3 }
  }
  let i = start
  while (i < input.length && input[i] !== ' ') i++
  return { value: input.slice(start, i), next: i }
}

export function parseListLine(line: string): { attributes: string[]; delimiter: string; mailbox: string } | null {
  const prefix = line.match(/^\* LIST\s+/i)
  if (!prefix) return null
  let i = prefix[0].length
  if (line[i] !== '(') return null
  i++
  const attrEnd = line.indexOf(')', i)
  if (attrEnd < 0) return null
  const attrRaw = line.slice(i, attrEnd).trim()
  const attributes = attrRaw ? attrRaw.split(/\s+/).map(a => a.replace(/^\\/, '')) : []
  i = attrEnd + 1
  while (line[i] === ' ') i++
  const delim = parseImapString(line, i)
  if (!delim) return null
  i = delim.next
  while (line[i] === ' ') i++
  const box = parseImapString(line, i)
  if (!box || !box.value) return null
  return {
    attributes,
    delimiter: delim.value || '/',
    mailbox: box.value,
  }
}

export function parseStatusLine(line: string): { mailbox: string; messages: number | null; unseen: number | null } | null {
  const prefix = line.match(/^\* STATUS\s+/i)
  if (!prefix) return null
  const rest = parseImapString(line, prefix[0].length)
  if (!rest) return null
  const paren = line.slice(rest.next).match(/\((.*)\)/)
  const body = paren?.[1] ?? ''
  const messages = /MESSAGES\s+(\d+)/i.exec(body)
  const unseen = /UNSEEN\s+(\d+)/i.exec(body)
  return {
    mailbox: rest.value,
    messages: messages ? Number(messages[1]) : null,
    unseen: unseen ? Number(unseen[1]) : null,
  }
}

class ImapSession {
  private socket: Socket
  private buffer = ''
  private tagSeq = 0
  private settled = false
  private readonly timeoutMs: number
  private readonly waiters: Array<{
    tag: string
    resolve: (lines: string[]) => void
    reject: (err: Error) => void
  }> = []
  private untagged: string[] = []

  constructor(socket: Socket, timeoutMs: number) {
    this.socket = socket
    this.timeoutMs = timeoutMs
    socket.on('data', chunk => this.onData(chunk.toString('utf8')))
  }

  private onData(chunk: string) {
    this.buffer += chunk
    const parts = this.buffer.split(/\r?\n/)
    this.buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line) continue
      const tagged = this.waiters.find(w => line.startsWith(w.tag + ' '))
      if (tagged) {
        const collected = [...this.untagged, line]
        this.untagged = []
        this.waiters.splice(this.waiters.indexOf(tagged), 1)
        tagged.resolve(collected)
      } else {
        this.untagged.push(line)
      }
    }
  }

  nextTag(): string {
    this.tagSeq += 1
    return `a${String(this.tagSeq).padStart(3, '0')}`
  }

  send(line: string) {
    this.socket.write(line + '\r\n')
  }

  waitForTag(tag: string, label: string, timeoutMs = this.timeoutMs): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex(w => w.tag === tag)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new Error(`IMAP timed out: ${label}`))
      }, timeoutMs)
      this.waiters.push({
        tag,
        resolve: lines => {
          clearTimeout(timer)
          resolve(lines)
        },
        reject,
      })
    })
  }

  command(cmd: string, timeoutMs = this.timeoutMs): Promise<string[]> {
    const tag = this.nextTag()
    const pending = this.waitForTag(tag, cmd.split(' ')[0], timeoutMs)
    this.send(`${tag} ${cmd}`)
    return pending
  }

  async commands(cmds: string[], timeoutMs = this.timeoutMs): Promise<string[]> {
    const tags = cmds.map(cmd => {
      const tag = this.nextTag()
      this.send(`${tag} ${cmd}`)
      return { tag, label: cmd.split(' ')[0] }
    })
    const collected: string[] = []
    for (const { tag, label } of tags) {
      collected.push(...await this.waitForTag(tag, label, timeoutMs))
    }
    return collected
  }

  waitGreeting(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off('data', onData)
        reject(new Error('Connection timed out'))
      }, this.timeoutMs)

      const check = () => {
        const greet = this.untagged.find(l => /^\* (OK|PREAUTH|BYE)\b/i.test(l))
        if (!greet) return false
        clearTimeout(timer)
        this.socket.off('data', onData)
        this.untagged = this.untagged.filter(l => l !== greet)
        if (/^\* BYE\b/i.test(greet)) {
          reject(new Error(greet.replace(/^\* BYE\s*/i, '').trim() || 'Server rejected the connection'))
        } else {
          resolve(greet)
        }
        return true
      }

      const onData = () => { check() }
      if (!check()) this.socket.on('data', onData)
    })
  }

  close() {
    if (this.settled) return
    this.settled = true
    try { this.socket.end() } catch { /* already closed */ }
    try { this.socket.destroy() } catch { /* already destroyed */ }
  }
}

function openSocket(host: string, port: number, ssl: boolean, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket: Socket = ssl
      ? tlsConnect({ host, port, servername: host, rejectUnauthorized: false })
      : netConnect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Connection timed out'))
    }, timeoutMs)
    socket.setTimeout(timeoutMs)
    socket.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    socket.once('timeout', () => {
      clearTimeout(timer)
      socket.destroy()
      reject(new Error('Connection timed out'))
    })
    const ready = ssl ? 'secureConnect' : 'connect'
    socket.once(ready, () => {
      clearTimeout(timer)
      resolve(socket)
    })
  })
}

function leafOf(fullName: string, delimiter: string): string {
  if (!delimiter) return fullName
  const parts = fullName.split(delimiter)
  return parts[parts.length - 1] || fullName
}

export async function listMailbox(params: ImapConnectParams): Promise<MailboxListing> {
  const timeoutMs = params.timeoutMs ?? 45000
  let session: ImapSession | null = null
  try {
    const socket = await openSocket(params.host, params.port, params.ssl, timeoutMs)
    session = new ImapSession(socket, timeoutMs)
    socket.on('error', () => session?.close())
    socket.on('close', () => { /* waiter timeouts handle this */ })

    await session.waitGreeting()

    const loginLines = await session.command(
      `LOGIN "${escapeQuoted(params.user)}" "${escapeQuoted(params.pass)}"`,
    )
    const loginTag = loginLines[loginLines.length - 1] ?? ''
    if (!/ OK\b/i.test(loginTag)) {
      const msg = loginTag.replace(/^\S+\s+(?:NO|BAD)\s*/i, '').trim()
      return { ok: false, delimiter: '/', folders: [], error: msg || 'Authentication failed' }
    }

    const listLines = await session.command('LIST "" "*"')
    const listTag = listLines[listLines.length - 1] ?? ''
    if (!/ OK\b/i.test(listTag)) {
      const msg = listTag.replace(/^\S+\s+(?:NO|BAD)\s*/i, '').trim()
      return { ok: false, delimiter: '/', folders: [], error: msg || 'LIST failed' }
    }

    const parsed = listLines
      .map(parseListLine)
      .filter((v): v is NonNullable<typeof v> => v !== null)

    const delimiter = parsed.find(p => p.delimiter)?.delimiter || '/'
    const folders: MailboxFolder[] = parsed.map(p => {
      const fullName = decodeModifiedUtf7(p.mailbox)
      const attributes = p.attributes
      const selectable = !attributes.some(a => a.toLowerCase() === 'noselect' || a.toLowerCase() === 'nonexistent')
      const folder: MailboxFolder = {
        path: p.mailbox,
        name: leafOf(fullName, p.delimiter || delimiter),
        fullName,
        delimiter: p.delimiter || delimiter,
        attributes,
        selectable,
        messages: null,
        unseen: null,
        special: null,
      }
      folder.special = detectSpecial(folder)
      return folder
    })

    const selectable = folders.filter(f => f.selectable)
    const toStatus = selectable.slice(0, MAX_STATUS_FOLDERS)
    const warning = selectable.length > MAX_STATUS_FOLDERS
      ? `Counted messages in the first ${MAX_STATUS_FOLDERS} of ${selectable.length} folders.`
      : undefined

    for (let i = 0; i < toStatus.length; i += STATUS_BATCH) {
      const batch = toStatus.slice(i, i + STATUS_BATCH)
      try {
        const lines = await session.commands(
          batch.map(folder => `STATUS ${quoteMailbox(folder.path)} (MESSAGES UNSEEN)`),
          25000,
        )
        for (const line of lines) {
          const status = parseStatusLine(line)
          if (!status) continue
          const folder = folders.find(f =>
            f.path === status.mailbox
            || f.fullName === status.mailbox
            || f.path.toLowerCase() === status.mailbox.toLowerCase()
          )
          if (!folder) continue
          folder.messages = status.messages
          folder.unseen = status.unseen
        }
      } catch {
        // batch failed — leave counts null
      }
    }

    try { await session.command('LOGOUT', 5000) } catch { /* ignore */ }
    session.close()

    return { ok: true, delimiter, folders, warning }
  } catch (e) {
    session?.close()
    return { ok: false, delimiter: '/', folders: [], error: (e as Error).message }
  }
}
