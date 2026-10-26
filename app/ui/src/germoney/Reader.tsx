/**
 * The in-app reader for study files. The desktop window (WebView2) cannot hand a
 * blob: URL to another app, so window.open(blob) showed "Get an app to open this
 * 'blob' link". Files open here instead: Markdown rendered as React elements (no
 * HTML is ever injected), PDFs and images in a frame. A calm reading column: ~68ch,
 * 1.7 line height, a fixed header with the title and close, tables that scroll sideways.
 */
import { ExternalLink, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { TOKEN } from '../lib/api'
import './pages/sections.css'

export const useReader = create<{ path: string | null; title: string; open: (path: string, title?: string) => void; close: () => void }>((set) => ({
  path: null, title: '',
  open: (path, title) => set({ path, title: title ?? path.split(/[\\/]/).pop() ?? path }),
  close: () => set({ path: null }),
}))

/* ------------------------------------------------------------------ a small Markdown renderer */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}-${m.index}`
    if (t.startsWith('**')) out.push(<b key={k}>{t.slice(2, -2)}</b>)
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else out.push(<i key={k}>{t.slice(1, -1)}</i>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (/^\s*```/.test(l)) {
      // Fenced code: kept verbatim as text inside <pre>, so nothing in it is ever parsed.
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      out.push(<pre key={`c${i}`} className="rd-code"><code>{code.join('\n')}</code></pre>)
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push(<hr key={`r${i}`} />); i++; continue }
    if (/^\s*>/.test(l)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push(<blockquote key={`q${i}`}>{inline(q.join(' '), i)}</blockquote>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) {
      const Tag = (`h${Math.min(4, h[1].length + 1)}`) as 'h2' | 'h3' | 'h4'
      out.push(<Tag key={i}>{inline(h[2], i)}</Tag>)
      i++
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()))
        i++
      }
      const [head, ...body] = rows
      out.push(<div key={`t${i}`} className="rd-table"><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
        <tbody>{body.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c, a * 100 + j)}</td>)}</tr>)}</tbody></table></div>)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: { depth: number; text: string }[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const d = (/^(\s*)/.exec(lines[i])?.[1].length ?? 0) >= 2 ? 1 : 0
        items.push({ depth: d, text: lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '') })
        i++
      }
      const L = ordered ? 'ol' : 'ul'
      out.push(<L key={`l${i}`}>{items.map((it, j) => <li key={j} className={it.depth ? 'sub' : ''}>{inline(it.text, j)}</li>)}</L>)
      continue
    }
    if (!l.trim()) { i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s|\s*```|\s*>)/.test(lines[i])) { para.push(lines[i]); i++ }
    out.push(<p key={`p${i}`}>{inline(para.join(' '), i)}</p>)
  }
  return out
}

export function ReaderDrawer() {
  const { path, title, close } = useReader()
  const [body, setBody] = useState<{ kind: 'md' | 'frame' | 'error'; text?: string; url?: string } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!path) return
    let url: string | null = null
    let live = true
    setBody(null)
    fetch(`/api/mission/academics/file?path=${encodeURIComponent(path)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        if (/\.(md|txt)$/i.test(path)) { const t = await r.text(); if (live) setBody({ kind: 'md', text: t }) }
        else { url = URL.createObjectURL(await r.blob()); if (live) setBody({ kind: 'frame', url }) }
      })
      .catch(() => { if (live) setBody({ kind: 'error' }) })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const back = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      live = false; window.removeEventListener('keydown', onKey); if (url) URL.revokeObjectURL(url)
      back?.focus?.({ preventScroll: true })   // hand focus back to the button that opened it
    }
  }, [path, close])
  // Parse once per file, not on every re-render of the drawer.
  const article = useMemo(() => (body?.kind === 'md' ? renderMarkdown(body.text ?? '') : null), [body])
  if (!path) return null
  const name = title.replace(/[-_]/g, ' ').replace(/\.(md|txt)$/i, '')
  return (
    <div className="drawer-scrim reader-scrim" onClick={close}>
      <aside className="reader" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <header className="reader-head">
          <span className="reader-title" title={name}>{name}</span>
          <button ref={closeRef} className="icon-btn reader-x" aria-label="Close" onClick={close}><X size={16} /></button>
        </header>
        <div className={`reader-body${body?.kind === 'frame' ? ' frame' : ''}`}>
          {!body && <p className="muted small">Opening…</p>}
          {body?.kind === 'error' && <p className="small">This file isn't one the app may open.</p>}
          {body?.kind === 'md' && <article className="rd">{article}</article>}
          {body?.kind === 'frame' && (/\.(png|jpe?g)$/i.test(path)
            ? <img className="rd-img" src={body.url} alt={name} />
            : <iframe className="rd-frame" src={body.url} title={name} />)}
        </div>
        {body?.kind === 'frame' && <p className="reader-foot muted small"><ExternalLink size={11} /> Scroll inside the page; Esc closes.</p>}
      </aside>
    </div>
  )
}
