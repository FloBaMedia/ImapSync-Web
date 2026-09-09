import { parseListLine, parseStatusLine } from '../src/lib/imap-session'
import { compareMailboxes, compilePerlish, parseRegexTransRules } from '../src/lib/mailbox-compare'
import { decodeModifiedUtf7 } from '../src/lib/imap-utf7'
import type { MailboxFolder } from '../src/lib/mailbox-types'

function folder(fullName: string, messages: number, extra: Partial<MailboxFolder> = {}): MailboxFolder {
  const delimiter = extra.delimiter ?? '/'
  const name = fullName.split(delimiter).pop() || fullName
  return {
    path: fullName,
    name,
    fullName,
    delimiter,
    attributes: [],
    selectable: true,
    messages,
    unseen: 0,
    special: extra.special ?? (fullName.toLowerCase() === 'inbox' ? 'inbox' : null),
    ...extra,
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const list = parseListLine('* LIST (\\HasNoChildren) "/" "INBOX"')
assert(list?.mailbox === 'INBOX' && list.delimiter === '/' && list.attributes.includes('HasNoChildren'), 'LIST INBOX')

const gmail = parseListLine('* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"')
assert(gmail?.mailbox === '[Gmail]/Sent Mail' && gmail.attributes.includes('Sent'), 'LIST Gmail sent')

const status = parseStatusLine('* STATUS "INBOX" (MESSAGES 12 UNSEEN 3)')
assert(status?.mailbox === 'INBOX' && status.messages === 12 && status.unseen === 3, 'STATUS INBOX')

assert(decodeModifiedUtf7('&APY-') === 'ö', 'UTF-7 ö')
assert(decodeModifiedUtf7('&APw-ber') === 'über', 'UTF-7 über')

const exclude = compilePerlish('(?i)Spam|Trash|Junk')
assert(exclude?.test('Spam') && exclude.test('trash'), 'exclude regex')

const rules = parseRegexTransRules('s#\\[Gmail\\]/Sent Mail#Sent#')
assert(rules.length === 1 && '[Gmail]/Sent Mail'.replace(rules[0].pattern, rules[0].replacement) === 'Sent', 'regextrans2')

const source = [
  folder('INBOX', 10, { special: 'inbox' }),
  folder('Sent', 4, { special: 'sent' }),
  folder('Work', 7),
  folder('Spam', 2),
]
const dest = [
  folder('INBOX', 10, { special: 'inbox' }),
  folder('Sent', 4, { special: 'sent' }),
  folder('Work', 5),
]
const result = compareMailboxes(source, dest, '/', {
  automap: true,
  subfolder2: '',
  exclude: '(?i)Spam|Trash|Junk',
  regextrans2: '',
})

assert(result.summary.matched === 2, `expected 2 matched, got ${result.summary.matched}`)
assert(result.summary.mismatch === 1, `expected 1 mismatch, got ${result.summary.mismatch}`)
assert(result.summary.missing === 0, `expected 0 missing, got ${result.summary.missing}`)
assert(result.summary.excluded === 1, `expected 1 excluded, got ${result.summary.excluded}`)
assert(result.summary.sourceMessages === 21, `excluded Spam from totals, got ${result.summary.sourceMessages}`)

const unknown = compareMailboxes(
  [folder('INBOX', 3), { ...folder('Work', 0), messages: null }],
  [folder('INBOX', 3), { ...folder('Work', 0), messages: null }],
  '/',
  { automap: true, subfolder2: '', exclude: '', regextrans2: '' },
)
assert(unknown.summary.unknown === 1, `expected 1 unknown count, got ${unknown.summary.unknown}`)
assert(unknown.summary.matched === 1, 'INBOX should still match')

const prefixed = compareMailboxes(
  [folder('INBOX', 1), folder('Work', 2)],
  [folder('Archive/INBOX', 1), folder('Archive/Work', 2)],
  '/',
  { automap: true, subfolder2: 'Archive', exclude: '', regextrans2: '' },
)
assert(prefixed.summary.matched === 2, `subfolder2 should map before compare, got ${prefixed.summary.matched}`)

const missing = compareMailboxes(
  [folder('INBOX', 3), folder('Archive', 9)],
  [folder('INBOX', 3)],
  '/',
  { automap: true, subfolder2: '', exclude: '', regextrans2: '' },
)
assert(missing.summary.missing === 1, 'Archive should be missing')

console.log('mailbox-selftest: ok')
