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
import { createPortal } from 'react-dom'
import { TOKEN } from '../lib/api'
import { texFallback } from '../ww/math/fallback'
import { renderMath } from '../ww/math/MathText'
import './pages/sections.css'

export const useReader = create<{ path: string | null; text: string | null; title: string; raw: boolean; toggleRaw: () => void
  open: (path: string, title?: string) => void; openText: (title: string, text: string) => void; close: () => void }>((set) => ({
  path: null, text: null, title: '', raw: false,
  // Raw shows the file as written: converted maths is never silent, one tap undoes it.
  toggleRaw: () => set((s) => ({ raw: !s.raw })),
  open: (path, title) => set({ path, text: null, title: title ?? path.split(/[\\/]/).pop() ?? path }),
  // Generated text (a practice paper) has no file: it is shown as it is, nothing is fetched.
  openText: (title, text) => set({ path: '(text)', text, title }),
  close: () => set({ path: null, text: null }),
}))

/* ------------------------------------------------------------------ a small Markdown renderer */
/** A formula between $...$ drawn by the home-grown fallback (sub/superscripts, \frac, \sqrt, Greek).
 *  Kept as an export for callers that want nodes without the component; the Reader itself goes through
 *  MathText (ww/math), which uses KaTeX once it has loaded and this renderer until then. */
export function math(src: string, key = 'm'): ReactNode[] { return texFallback(src, key) }

function inline(text: string, key = 0, raw = false): ReactNode[] {
  const out: ReactNode[] = []
  // `_word_` is italic only as a whole word: underscores inside identifiers (int_0^inf, V_OD) are text.
  const re = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|(?<![\w$])_[^_\s][^_\n]*?_(?![\w]))/g
  // A line with a $ in it was authored as LaTeX: its plain stretches are left alone. A line without one is
  // the old ASCII / Unicode dialect and goes through toTex (the Reader's "Raw" button undoes that).
  const authored = text.includes('$')
  const plain = (s: string, k: string) => { out.push(...renderMath(s, { raw, tex: authored, keyPrefix: k })) }
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) plain(text.slice(last, m.index), `${key}-${last}`)
    const t = m[0]
    const k = `${key}-${m.index}`
    if (t.startsWith('$')) { if (raw) out.push(t); else out.push(...renderMath(t, { tex: true, keyPrefix: k })) }
    else if (t.startsWith('**')) out.push(<b key={k}>{t.slice(2, -2)}</b>)
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>)
    else out.push(<i key={k}>{t.slice(1, -1)}</i>)
    last = m.index + t.length
  }
  if (last < text.length) plain(text.slice(last), `${key}-${last}`)
  return out
}

export function renderMarkdown(src: string, opts: { raw?: boolean } = {}): ReactNode[] {
  const raw = opts.raw === true
  const lines = src.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  // A paper is one numbered list: its sections each restart at 1 in the generated text, so a list that starts at 1
  // under a "Section ..." heading carries on from the last list (audit FMT-3: 20 one-item lists, each numbered 1).
  let nextNumber = 1
  let lastHeading = ''
  const inl = (t: string, k: number) => inline(t, k, raw)
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
    if (/^\s*\$\$/.test(l)) {
      // Display maths on its own line(s): $$ ... $$, centred by MathText.
      const first = l.trim().slice(2)
      const body: string[] = []
      if (first.includes('$$')) { body.push(first.slice(0, first.indexOf('$$'))); i++ }
      else {
        body.push(first)
        i++
        while (i < lines.length && !lines[i].includes('$$')) { body.push(lines[i]); i++ }
        if (i < lines.length) { body.push(lines[i].slice(0, lines[i].indexOf('$$'))); i++ }
      }
      const tex = body.join(' ').trim()
      out.push(raw ? <p key={`d${i}`}>{`$$${tex}$$`}</p> : <div key={`d${i}`} className="rd-display">{renderMath(`$$${tex}$$`, { tex: true, keyPrefix: `d${i}` })}</div>)
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push(<hr key={`r${i}`} />); i++; continue }
    if (/^\s*>/.test(l)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      out.push(<blockquote key={`q${i}`}>{inl(q.join(' '), i)}</blockquote>)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l)
    if (h) {
      const Tag = (`h${Math.min(4, h[1].length + 1)}`) as 'h2' | 'h3' | 'h4'
      lastHeading = h[2]
      out.push(<Tag key={i}>{inl(h[2], i)}</Tag>)
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
      out.push(<div key={`t${i}`} className="rd-table"><table><thead><tr>{head.map((c, j) => <th key={j}>{inl(c, j)}</th>)}</tr></thead>
        <tbody>{body.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inl(c, a * 100 + j)}</td>)}</tr>)}</tbody></table></div>)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const first = ordered ? Number(/^\s*(\d+)\./.exec(l)![1]) : 1
      const items: { depth: number; text: string; more: string[] }[] = []
      for (;;) {
        const cur = lines[i]
        if (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(cur)) {
          const d = (/^(\s*)/.exec(cur)?.[1].length ?? 0) >= 2 ? 1 : 0
          items.push({ depth: d, text: cur.replace(/^\s*([-*]|\d+\.)\s+/, ''), more: [] })
          i++
        } else if (items.length && i < lines.length && /^\s{2,}\S/.test(cur) && !/^\s*(#{1,4}\s|\||```|>)/.test(cur)) {
          // An indented line under an item belongs to it (the paper's "_Unit 2, topic; source_" line), not to a new paragraph.
          items[items.length - 1].more.push(cur.trim())
          i++
        } else break
      }
      const L = ordered ? 'ol' : 'ul'
      const start = ordered && first === 1 && nextNumber > 1 && /^section\b/i.test(lastHeading) ? nextNumber : first
      if (ordered) nextNumber = start + items.filter((it) => !it.depth).length
      out.push(<L key={`l${i}`} {...(ordered && start !== 1 ? { start } : {})}>{items.map((it, j) => (
        <li key={j} className={it.depth ? 'sub' : ''}>{inl(it.text, j)}{it.more.map((m, x) => <span key={x}><br />{inl(m, j * 10 + x + 1000)}</span>)}</li>))}</L>)
      continue
    }
    if (!l.trim()) { i++; continue }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s|\s*```|\s*>)/.test(lines[i])) { para.push(lines[i]); i++ }
    out.push(<p key={`p${i}`}>{inl(para.join(' '), i)}</p>)
  }
  return out
}

export function ReaderDrawer() {
  const { path, text, title, close, raw, toggleRaw } = useReader()
  const [body, setBody] = useState<{ kind: 'md' | 'frame' | 'error'; text?: string; url?: string } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!path) return
    let url: string | null = null
    let live = true
    setBody(text != null ? { kind: 'md', text } : null)
    if (text == null) fetch(`/api/mission/academics/file?path=${encodeURIComponent(path)}`, { headers: { 'X-Jarvis-Token': TOKEN } })
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
  }, [path, text, close])
  // Parse once per file, not on every re-render of the drawer.
  const article = useMemo(() => (body?.kind === 'md' ? renderMarkdown(body.text ?? '', { raw }) : null), [body, raw])
  if (!path) return null
  const name = title.replace(/[-_]/g, ' ').replace(/\.(md|txt)$/i, '')
  // On document.body, not inside the scrolling `.page`: a transformed ancestor turns `position: fixed`
  // into "fixed to that box", and the Reader scrolled away with the page (audit STUDY-01, 9 Nov).
  return createPortal(
    <div className="ww-portal" data-glass={glassOfPage()}>
    <div className="drawer-scrim reader-scrim" onClick={close}>
      <aside className="reader" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <header className="reader-head">
          <span className="reader-title" title={name}>{name}</span>
          {body?.kind === 'md' && <button className="btn sm ghost reader-raw" aria-pressed={raw} title="Show the text as written, without typeset maths" onClick={toggleRaw}>Raw</button>}
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
    </div>,
    document.body,
  )
}

/** The page's measured glass tier, so a portal outside the page keeps the same look. */
export function glassOfPage(): string {
  return document.querySelector('.page.mission')?.getAttribute('data-glass') ?? 'flat'
}
