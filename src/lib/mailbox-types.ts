export type SpecialUse =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'flagged'
  | 'all'

export interface MailboxFolder {
  path: string
  name: string
  fullName: string
  delimiter: string
  attributes: string[]
  selectable: boolean
  messages: number | null
  unseen: number | null
  special: SpecialUse | null
}

export interface MailboxServerInfo {
  name: string
  host: string
}

export interface MailboxListing {
  ok: boolean
  email?: string
  server?: MailboxServerInfo
  delimiter: string
  folders: MailboxFolder[]
  warning?: string
  error?: string
}

export type CompareStatus = 'matched' | 'mismatch' | 'missing' | 'extra' | 'excluded'

export interface CompareSide {
  path: string
  fullName: string
  messages: number | null
  unseen: number | null
  special: SpecialUse | null
}

export interface CompareRow {
  id: string
  status: CompareStatus
  source?: CompareSide
  dest?: CompareSide
  expectedDestName?: string
  messageDelta: number | null
}

export interface MailboxCompareSummary {
  sourceFolders: number
  destFolders: number
  matched: number
  mismatch: number
  missing: number
  extra: number
  excluded: number
  sourceMessages: number
  destMatchedMessages: number
  destMessages: number
}

export interface MailboxCompareResult {
  rows: CompareRow[]
  summary: MailboxCompareSummary
}

export interface MailboxMapOptions {
  automap: boolean
  subfolder2: string
  exclude: string
  regextrans2: string
}
