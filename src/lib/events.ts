import { EventEmitter } from 'events'

const emitters = new Map<string, EventEmitter>()

export function getOrCreateEmitter(accountId: string): EventEmitter {
  if (!emitters.has(accountId)) {
    const ee = new EventEmitter()
    ee.setMaxListeners(50)
    emitters.set(accountId, ee)
  }
  return emitters.get(accountId)!
}

export function emitLog(accountId: string, line: string): void {
  const ee = emitters.get(accountId)
  if (ee) ee.emit('log', line)
}

export function closeStream(accountId: string): void {
  const ee = emitters.get(accountId)
  if (ee) {
    ee.emit('done')
    emitters.delete(accountId)
  }
}

export function isAccountActive(accountId: string): boolean {
  return emitters.has(accountId)
}
