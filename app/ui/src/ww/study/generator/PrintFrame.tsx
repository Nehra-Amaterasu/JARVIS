// PrintFrame (package X03): the paper as the browser prints it, in a hidden iframe of its own. The sheet is drawn there by a portal
// from the same React tree, with the stylesheet of the sheet and one @page rule (A4, 18 mm margins), so the printed page holds the
// paper and nothing else: no shell, no rail, no chrome, and nothing in the app's own styles has to be switched off for a print. The
// iframe is not drawn on screen (it has no size) and holds no timer. `print()` asks the browser to print that frame; the student
// picks "Save as PDF" in the browser's own dialog.
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { PrintSheet, type PrintKind } from './PrintSheet'
import type { PaperView } from './model'
import sheetCss from './sheet.css?inline'

/** One page rule and a clean document; light colour scheme so "Canvas" and "CanvasText" are white and black in any app theme. */
export const FRAME_CSS = '@page{size:A4;margin:18mm}html{color-scheme:light}html,body{margin:0;padding:0;background:Canvas;color:CanvasText}'

export interface PrintHandle {
  /** Ask the browser to print the frame. Returns false when the frame is not ready. */
  print: () => boolean
  /** The frame's document, for a test or the bench. */
  doc: () => Document | null
}

export interface PrintFrameProps {
  paper: PaperView
  kind: PrintKind
  stamp?: string
  ref?: Ref<PrintHandle>
}

const SRC_DOC = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Practice paper</title><style>${FRAME_CSS}${typeof sheetCss === 'string' ? sheetCss : ''}</style></head><body></body></html>`

export function PrintFrame({ paper, kind, stamp, ref }: PrintFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [body, setBody] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const f = frame.current
    if (!f) return
    const grab = () => setBody(f.contentDocument?.body ?? null)
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.body) grab()
    f.addEventListener('load', grab)
    return () => f.removeEventListener('load', grab)
  }, [])
  useImperativeHandle(ref, () => ({
    print: () => {
      const w = frame.current?.contentWindow
      if (!w || !body) return false
      w.focus()
      w.print()
      return true
    },
    doc: () => frame.current?.contentDocument ?? null,
  }), [body])
  return (
    <>
      <iframe ref={frame} className="gx-frame" title="The paper as it prints" aria-hidden="true" tabIndex={-1} srcDoc={SRC_DOC} data-print-frame />
      {body && createPortal(<PrintSheet paper={paper} kind={kind} stamp={stamp} />, body)}
    </>
  )
}
