// A small reader for the Markdown notes the Classroom sync writes. There is no Markdown library in the project, and the notes hold
// exactly four things, so this renders those and nothing else: a `---` front-matter block at the top (its title, course and pages
// become a small header, never raw text), `#`, `##` and `###` headings, `>` block quotes, and paragraphs split by blank lines.
//
// It builds React elements from text and never sets HTML, so a line that holds `<script>` is shown as the characters it is
// (React escapes every string child). Links and emphasis are not interpreted: a note is shown as it was written.
import type { ReactNode } from 'react'

export interface NoteBlock { kind: 'h1' | 'h2' | 'h3' | 'quote' | 'p'; text: string }
export interface ParsedNote { meta: Record<string, string>; blocks: NoteBlock[] }

/** The front-matter keys the reader shows, in order. */
export const META_KEYS = ['title', 'course', 'pages'] as const

const unquote = (v: string): string => {
  const t = v.trim()
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t
}

/** The `---` block at the very top, or null. An unclosed block is not front matter: the lines stay text. */
function frontMatter(lines: string[]): { meta: Record<string, string>; rest: string[] } | null {
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return null
  const meta: Record<string, string> = {}
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l)
    if (m) meta[m[1].toLowerCase()] = unquote(m[2])
  }
  return { meta, rest: lines.slice(end + 1) }
}

export function parseNote(markdown: string): ParsedNote {
  const all = markdown.replace(/\r\n?/g, '\n').split('\n')
  const fm = frontMatter(all)
  const lines = fm ? fm.rest : all
  const blocks: NoteBlock[] = []
  let para: string[] = []
  let quote: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    if (quote.length) blocks.push({ kind: 'quote', text: quote.join('\n') })
    para = []
    quote = []
  }
  for (const line of lines) {
    if (line.trim() === '') { flush(); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) { flush(); blocks.push({ kind: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], text: h[2].trim() }); continue }
    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      // a quote ends where a plain line starts, so the two never merge into one block
      if (para.length) flush()
      quote.push(q[1])
      continue
    }
    if (quote.length) flush()
    para.push(line)
  }
  flush()
  return { meta: fm?.meta ?? {}, blocks }
}

const BLOCK: Record<NoteBlock['kind'], (text: string, key: number) => ReactNode> = {
  // the reader sits under the page's own h2, so a note's `#` is an h3
  h1: (t, k) => <h3 key={k} className="cr-md-h1">{t}</h3>,
  h2: (t, k) => <h4 key={k} className="cr-md-h2">{t}</h4>,
  h3: (t, k) => <h5 key={k} className="cr-md-h3">{t}</h5>,
  quote: (t, k) => <blockquote key={k} className="cr-md-quote">{t}</blockquote>,
  p: (t, k) => <p key={k} className="cr-md-p">{t}</p>,
}

export function NoteView({ markdown }: { markdown: string }) {
  const note = parseNote(markdown)
  const shown = META_KEYS.filter((k) => note.meta[k])
  return (
    <article className="cr-md" data-component="note-view">
      {shown.length > 0 && (
        <dl className="cr-md-meta" data-component="note-meta">
          {shown.map((k) => <div key={k}><dt>{k}</dt><dd>{note.meta[k]}</dd></div>)}
        </dl>
      )}
      {note.blocks.map((b, i) => BLOCK[b.kind](b.text, i))}
    </article>
  )
}
