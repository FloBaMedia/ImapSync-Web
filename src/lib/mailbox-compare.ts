import type {
  CompareRow,
  MailboxCompareResult,
  MailboxFolder,
  MailboxMapOptions,
  SpecialUse,
} from './mailbox-types'

const SPECIAL_NAMES: Record<SpecialUse, string[]> = {
  inbox: ['inbox'],
  sent: [
    'sent', 'sent items', 'sent messages', 'sent mail',
    '[gmail]/sent mail', 'gesendet', 'gesendete objekte', 'éléments envoyés',
  ],
  drafts: ['drafts', 'draft', '[gmail]/drafts', 'entwürfe', 'brouillons'],
  trash: [
    'trash', 'deleted items', 'deleted', 'deleted messages',
    '[gmail]/trash', 'papierkorb', 'gelöschte elemente', 'éléments supprimés',
  ],
  junk: ['junk', 'spam', 'junk email', 'junk e-mail', '[gmail]/spam'],
  archive: ['archive', '[gmail]/all mail', 'all mail'],
  flagged: ['flagged', 'starred', '[gmail]/starred'],
  all: ['all', 'all mail', '[gmail]/all mail'],
}

export function compilePerlish(pattern: string): RegExp | null {
  const trimmed = pattern.trim()
  if (!trimmed) return null
  let flags = ''
  let body = trimmed
  if (body.startsWith('(?i)')) {
    flags += 'i'
    body = body.slice(4)
  }
  try {
    return new RegExp(body, flags)
  } catch {
    return null
  }
}

export function parseRegexTransRules(raw: string): Array<{ pattern: RegExp; replacement: string }> {
  const rules: Array<{ pattern: RegExp; replacement: string }> = []
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const match = /^s(.)(.+?)\1(.*)\1([gimsuy]*)$/.exec(text)
    if (!match) continue
    const [, , source, replacement, flags] = match
    try {
      rules.push({ pattern: new RegExp(source, flags), replacement })
    } catch {
      // skip invalid rule
    }
  }
  return rules
}

function leafName(fullName: string, delimiter: string): string {
  if (!delimiter) return fullName
  const parts = fullName.split(delimiter)
  return parts[parts.length - 1] || fullName
}

function normalizeDelim(path: string, from: string, to: string): string {
  if (!from || from === to) return path
  return path.split(from).join(to)
}

export function detectSpecial(folder: Pick<MailboxFolder, 'fullName' | 'attributes' | 'path'>): SpecialUse | null {
  const attrs = folder.attributes.map(a => a.replace(/^\\/, '').toLowerCase())
  if (attrs.includes('inbox') || folder.fullName.toLowerCase() === 'inbox' || folder.path.toUpperCase() === 'INBOX') {
    return 'inbox'
  }
  const attrMap: Array<[string, SpecialUse]> = [
    ['sent', 'sent'],
    ['drafts', 'drafts'],
    ['trash', 'trash'],
    ['junk', 'junk'],
    ['archive', 'archive'],
    ['flagged', 'flagged'],
    ['all', 'all'],
  ]
  for (const [attr, use] of attrMap) {
    if (attrs.includes(attr)) return use
  }
  const key = folder.fullName.toLowerCase()
  for (const [use, names] of Object.entries(SPECIAL_NAMES) as Array<[SpecialUse, string[]]>) {
    if (names.includes(key)) return use
  }
  return null
}

function applyRegexTrans(name: string, rules: Array<{ pattern: RegExp; replacement: string }>): string {
  let out = name
  for (const rule of rules) {
    out = out.replace(rule.pattern, rule.replacement)
  }
  return out
}

function mapSourceToDest(
  folder: MailboxFolder,
  destDelimiter: string,
  destFolders: MailboxFolder[],
  options: MailboxMapOptions,
  rules: Array<{ pattern: RegExp; replacement: string }>,
): { expected: string } {
  // imapsync order: automap / delimiter, then --subfolder2, then --regextrans2
  let mapped = normalizeDelim(folder.fullName, folder.delimiter || '/', destDelimiter || '/')

  if (options.automap && folder.special && folder.special !== 'inbox') {
    const destSpecial = destFolders.find(d => d.special === folder.special)
    mapped = destSpecial
      ? destSpecial.fullName
      : folder.special.charAt(0).toUpperCase() + folder.special.slice(1)
  }

  if (options.subfolder2) {
    mapped = `${options.subfolder2}${destDelimiter || '/'}${mapped}`
  }
  mapped = applyRegexTrans(mapped, rules)
  return { expected: mapped }
}

function findDest(
  expected: string,
  destFolders: MailboxFolder[],
  destDelimiter: string,
): MailboxFolder | undefined {
  const expectedLower = expected.toLowerCase()
  const byName = destFolders.find(d => d.fullName === expected || d.path === expected)
  if (byName) return byName
  const byCase = destFolders.find(d => d.fullName.toLowerCase() === expectedLower)
  if (byCase) return byCase
  const norm = (p: string) => normalizeDelim(p, destDelimiter || '/', '/').toLowerCase()
  return destFolders.find(d => norm(d.fullName) === norm(expected))
}

function toSide(folder: MailboxFolder) {
  return {
    path: folder.path,
    fullName: folder.fullName,
    messages: folder.messages,
    unseen: folder.unseen,
    special: folder.special,
  }
}

function sumMessages(folders: MailboxFolder[]): number {
  return folders.reduce((n, f) => n + (f.messages ?? 0), 0)
}

export function compareMailboxes(
  sourceFolders: MailboxFolder[],
  destFolders: MailboxFolder[],
  destDelimiter: string,
  options: MailboxMapOptions,
): MailboxCompareResult {
  const excludeRe = compilePerlish(options.exclude)
  const rules = parseRegexTransRules(options.regextrans2)
  const usedDest = new Set<string>()
  const rows: CompareRow[] = []
  let id = 0

  const selectableSource = sourceFolders.filter(f => f.selectable)
  const selectableDest = destFolders.filter(f => f.selectable)

  for (const src of selectableSource) {
    const excluded = excludeRe ? excludeRe.test(src.fullName) || excludeRe.test(src.path) : false
    if (excluded) {
      rows.push({
        id: `row-${++id}`,
        status: 'excluded',
        source: toSide(src),
        messageDelta: null,
      })
      continue
    }

    const { expected } = mapSourceToDest(src, destDelimiter, selectableDest, options, rules)
    const dest = findDest(expected, selectableDest, destDelimiter)

    if (!dest) {
      rows.push({
        id: `row-${++id}`,
        status: 'missing',
        source: toSide(src),
        expectedDestName: expected,
        messageDelta: src.messages === null ? null : -(src.messages),
      })
      continue
    }

    usedDest.add(dest.path)
    const srcCount = src.messages
    const destCount = dest.messages
    const delta = srcCount === null || destCount === null ? null : destCount - srcCount
    const countsKnown = srcCount !== null && destCount !== null
    const status = !countsKnown ? 'unknown' : srcCount === destCount ? 'matched' : 'mismatch'
    rows.push({
      id: `row-${++id}`,
      status,
      source: toSide(src),
      dest: toSide(dest),
      expectedDestName: expected,
      messageDelta: delta,
    })
  }

  for (const dest of selectableDest) {
    if (usedDest.has(dest.path)) continue
    // Parent prefixes created by --subfolder2 are expected leftovers, not extras
    if (options.subfolder2 && dest.fullName === options.subfolder2) continue
    rows.push({
      id: `row-${++id}`,
      status: 'extra',
      dest: toSide(dest),
      messageDelta: dest.messages,
    })
  }

  const statusOrder: Record<CompareRow['status'], number> = {
    missing: 0,
    mismatch: 1,
    unknown: 2,
    extra: 3,
    matched: 4,
    excluded: 5,
  }
  rows.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status]
    if (so !== 0) return so
    const an = a.source?.fullName ?? a.dest?.fullName ?? ''
    const bn = b.source?.fullName ?? b.dest?.fullName ?? ''
    return an.localeCompare(bn)
  })

  const matchedRows = rows.filter(r => r.status === 'matched' || r.status === 'mismatch')
  const destMatchedMessages = matchedRows.reduce((n, r) => n + (r.dest?.messages ?? 0), 0)

  return {
    rows,
    summary: {
      sourceFolders: selectableSource.length,
      destFolders: selectableDest.length,
      matched: rows.filter(r => r.status === 'matched').length,
      mismatch: rows.filter(r => r.status === 'mismatch').length,
      unknown: rows.filter(r => r.status === 'unknown').length,
      missing: rows.filter(r => r.status === 'missing').length,
      extra: rows.filter(r => r.status === 'extra').length,
      excluded: rows.filter(r => r.status === 'excluded').length,
      sourceMessages: sumMessages(selectableSource.filter(f =>
        !(excludeRe && (excludeRe.test(f.fullName) || excludeRe.test(f.path))),
      )),
      destMatchedMessages,
      destMessages: sumMessages(selectableDest),
    },
  }
}

export function folderLeaf(fullName: string, delimiter: string): string {
  return leafName(fullName, delimiter)
}
