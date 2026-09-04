import type { MailboxFolder } from './mailbox-types'

export interface FolderNode {
  folder: MailboxFolder
  children: FolderNode[]
}

function specialRank(folder: MailboxFolder): number {
  const order = ['inbox', 'sent', 'drafts', 'archive', 'flagged', 'junk', 'trash', 'all']
  if (!folder.special) return 50
  const i = order.indexOf(folder.special)
  return i === -1 ? 40 : i
}

function sortNodes(nodes: FolderNode[]): FolderNode[] {
  return nodes.sort((a, b) => {
    const r = specialRank(a.folder) - specialRank(b.folder)
    if (r !== 0) return r
    return a.folder.fullName.localeCompare(b.folder.fullName, undefined, { sensitivity: 'base' })
  })
}

export function buildFolderTree(folders: MailboxFolder[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>()
  for (const folder of folders) {
    nodes.set(folder.fullName, { folder, children: [] })
  }

  const roots: FolderNode[] = []
  for (const folder of folders) {
    const node = nodes.get(folder.fullName)!
    const delim = folder.delimiter || '/'
    const idx = folder.fullName.lastIndexOf(delim)
    const parentName = idx > 0 ? folder.fullName.slice(0, idx) : ''
    const parent = parentName ? nodes.get(parentName) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  const walk = (list: FolderNode[]) => {
    sortNodes(list)
    for (const n of list) walk(n.children)
  }
  walk(roots)
  return roots
}

export function formatCount(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString('en-US')
}

export function folderMatchesQuery(folder: MailboxFolder, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return folder.fullName.toLowerCase().includes(q) || folder.name.toLowerCase().includes(q)
}

export function filterTree(nodes: FolderNode[], query: string): FolderNode[] {
  if (!query.trim()) return nodes
  const keep = (node: FolderNode): FolderNode | null => {
    const children = node.children.map(keep).filter((n): n is FolderNode => n !== null)
    if (folderMatchesQuery(node.folder, query) || children.length > 0) {
      return { folder: node.folder, children }
    }
    return null
  }
  return nodes.map(keep).filter((n): n is FolderNode => n !== null)
}

export function countMessages(folders: MailboxFolder[]): { messages: number; unseen: number; known: boolean } {
  let messages = 0
  let unseen = 0
  let known = false
  for (const f of folders) {
    if (f.messages !== null) {
      messages += f.messages
      known = true
    }
    if (f.unseen !== null) unseen += f.unseen
  }
  return { messages, unseen, known }
}
