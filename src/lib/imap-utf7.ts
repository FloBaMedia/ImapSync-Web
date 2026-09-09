// IMAP mailbox names use modified UTF-7 (RFC 3501 §5.1.3).
// `&` starts a Base64 run, `-` ends it, `&-` is a literal `&`.
// The alphabet uses `,` instead of `/`. Encoded text is UTF-16BE.

export function decodeModifiedUtf7(input: string): string {
  return input.replace(/&([^-]*)-/g, (_, body: string) => {
    if (body === '') return '&'
    const standard = body.replace(/,/g, '/')
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4)
    const bytes = Buffer.from(padded, 'base64')
    let out = ''
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    }
    return out
  })
}

export function encodeModifiedUtf7(input: string): string {
  let out = ''
  let buf = ''

  const flush = () => {
    if (!buf) return
    const bytes = Buffer.alloc(buf.length * 2)
    for (let i = 0; i < buf.length; i++) {
      bytes[i * 2] = buf.charCodeAt(i) >> 8
      bytes[i * 2 + 1] = buf.charCodeAt(i) & 0xff
    }
    const b64 = bytes.toString('base64').replace(/\//g, ',').replace(/=+$/, '')
    out += `&${b64}-`
    buf = ''
  }

  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '&') {
      flush()
      out += '&-'
    } else if (code >= 0x20 && code <= 0x7e) {
      flush()
      out += ch
    } else {
      buf += ch
    }
  }
  flush()
  return out
}
