/**
 * Shared pieces for the Mission tabs, in the JARVIS design language.
 *
 * Germoney's meaning survives the restyle:
 *   proof-locked / defeated   cyan   (confirmed by evidence)
 *   AI-generated content      amber  (inferred — the local model wrote it)
 *   purgatory / boss / failure red   (fault state)
 *   XP and ranks              chrome (identity)
 */
import { Check, Image as ImageIcon, Lock, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useStore, type Tab } from '../lib/store'
import { useDialog } from './platform'
import { dateKey, usePlayerStore } from './stores/player-store'
import type { ProofEntry, ProofType } from './stores/proof-store'

/* ------------------------------------------------------------------ sub-navigation */
export const MISSION_TABS: { id: Tab; label: string }[] = [
  { id: 'mission', label: 'Command' }, { id: 'quests', label: 'Quests' }, { id: 'crucible', label: 'Crucible' },
  { id: 'forge', label: 'Forge' }, { id: 'syllabus', label: 'Syllabus' }, { id: 'terminal', label: 'Terminal' },
  { id: 'interrogation', label: 'Interrogation' }, { id: 'proof', label: 'Proof' }, { id: 'schedule', label: 'Schedule' },
]

export function MissionNav() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const purgatory = usePlayerStore((s) => s.player.isPurgatoryActive)
  return (
    <nav className="mission-nav" aria-label="Mission">
      <span className="mn-brand mono">m:ss:on_ger-money</span>
      {MISSION_TABS.map((t) => (
        <button key={t.id} className={`mn-tab ${tab === t.id ? 'on' : ''} ${t.id === 'crucible' && purgatory ? 'alarm' : ''}`}
          onClick={() => setTab(t.id)}>{t.label}</button>
      ))}
    </nav>
  )
}

export function MissionHeader({ n, title, sub, right }: { n: string; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="page-head mission-head">
      <div>
        <div className="ph-meta">
          <span className="mono ph-n">{n}</span>
          <span className="ph-rule" />
          <span className="eyebrow">{sub}</span>
        </div>
        <h1 className="display ph-title"><span className="chrome-text">{title}</span></h1>
      </div>
      {right && <div className="ph-right">{right}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ XP bursts */
interface Burst { id: number; x: number; y: number; text: string; tone: string }
const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
window.addEventListener('pointerdown', (e) => { pointer.x = e.clientX; pointer.y = e.clientY }, { capture: true })

export const useFx = create<{ bursts: Burst[]; burst: (text: string, tone?: string) => void; flash: boolean; boss: () => void }>((set, get) => ({
  bursts: [],
  flash: false,
  /** "+25 XP" rises from where you clicked: the reward is attached to the action. */
  burst: (text, tone = 'chrome') => {
    const b = { id: Date.now() + Math.random(), x: pointer.x, y: pointer.y, text, tone }
    set({ bursts: [...get().bursts, b] })
    window.setTimeout(() => set({ bursts: get().bursts.filter((x) => x.id !== b.id) }), 1400)
  },
  boss: () => {
    set({ flash: true })
    window.setTimeout(() => set({ flash: false }), 900)
  },
}))

export function FxLayer() {
  const bursts = useFx((s) => s.bursts)
  const flash = useFx((s) => s.flash)
  return (
    <>
      {flash && <div className="fx-flash" />}
      {bursts.map((b) => (
        <span key={b.id} className={`fx-burst dot ${b.tone}`} style={{ left: b.x, top: b.y }}>{b.text}</span>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ dialogs (Alert with buttons) */
export function Dialogs() {
  const open = useDialog((s) => s.open)
  const close = useDialog((s) => s.close)
  if (!open) return null
  return (
    <div className="palette-scrim" onMouseDown={close}>
      <div className="dialog glass" role="alertdialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="display dialog-title">{open.title}</div>
        {open.message && <p className="dim">{open.message}</p>}
        <div className="dialog-btns">
          {open.buttons.map((b) => (
            <button key={b.text} className={`btn ${b.style === 'destructive' ? 'danger' : b.style === 'cancel' ? 'ghost' : 'primary'}`}
              onClick={() => { close(); b.onPress?.() }}>{b.text}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function confirmDialog(title: string, message: string, ok: string, onOk: () => void, destructive = true) {
  useDialog.setState({ open: { title, message, buttons: [
    { text: 'Cancel', style: 'cancel' },
    { text: ok, style: destructive ? 'destructive' : 'default', onPress: onOk },
  ] } })
}

/* ------------------------------------------------------------------ rank bar */
export function NeonBar({ progress, tone = 'chrome' }: { progress: number; tone?: 'chrome' | 'live' | 'fault' | 'sim' }) {
  return <div className={`neon-bar ${tone}`}><i style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /></div>
}

/* ------------------------------------------------------------------ checklist row */
export function CheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button className={`check-row ${checked ? 'on' : ''}`} role="checkbox" aria-checked={checked} onClick={onToggle}>
      <span className="box">{checked && <Check size={12} strokeWidth={3} />}</span>
      <span className="lbl">{label}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ burn heatmap */
/** 12 weeks of activity: real GitHub days when linked, else the local execution log.
 *  The source is printed — a heatmap that doesn't say what it counts is decoration. */
export function BurnHeatmap({ github }: { github?: { days: { date: string; count: number }[] } | null }) {
  const log = usePlayerStore((s) => s.player.activityLog)
  const WEEKS = 12
  const cells = useMemo(() => {
    const gh = new Map((github?.days ?? []).map((d) => [d.date, d.count]))
    const local = new Map<string, number>()
    for (const e of log) local.set(e.date, (local.get(e.date) ?? 0) + 1)
    const today = new Date()
    const end = new Date(today)
    end.setDate(today.getDate() + (6 - ((today.getDay() + 6) % 7)))   // end on Sunday
    const out: { date: string; count: number; future: boolean }[] = []
    for (let i = WEEKS * 7 - 1; i >= 0; i--) {
      const d = new Date(end)
      d.setDate(end.getDate() - i)
      const k = dateKey(d)
      out.push({ date: k, count: (gh.size ? gh.get(k) : local.get(k)) ?? 0, future: d > today })
    }
    return out
  }, [github, log])
  const tier = (c: number) => (c <= 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4)
  const active = cells.filter((c) => c.count > 0).length
  return (
    <div className="heatmap">
      <div className="hc-head">
        <span className="eyebrow">Burn rate · {github?.days?.length ? 'GitHub (public)' : 'local log'}</span>
        <span className="mono muted">{active} active days / {WEEKS} weeks</span>
      </div>
      <div className="heat-grid" style={{ gridTemplateRows: 'repeat(7, 1fr)' }}>
        {cells.map((c) => <i key={c.date} className={`t${tier(c.count)} ${c.future ? 'future' : ''}`} title={`${c.date}: ${c.count}`} />)}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ proof */
const MIN_TEXT = 15

/** Downscale a photo in the browser before it's saved: proof, not a photo library. */
async function shrink(file: File, max = 1024): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.78)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ProofGate({ tone = 'chrome', onCancel, onConfirm }: { tone?: string; onCancel: () => void; onConfirm: (p: { type: ProofType; value: string }) => void }) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const ok = text.trim().length >= MIN_TEXT || !!image
  return (
    <div className={`proof-gate ${tone} fade-in`}>
      <span className="eyebrow">// Proof of work required</span>
      <p className="muted">Write what you actually did ({MIN_TEXT}+ characters) or attach a photo. Honor system — nobody checks but you.</p>
      <textarea className="field area" placeholder="What did you actually do / learn?" value={text} onChange={(e) => setText(e.target.value)} />
      {image && (
        <div className="thumb"><img src={image} alt="proof" /><button className="btn ghost sm icon" onClick={() => setImage(null)} aria-label="Remove photo"><X size={13} /></button></div>
      )}
      <div className="gate-row">
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await shrink(f)) }} />
        <button className="btn sm" onClick={() => file.current?.click()}><ImageIcon size={13} />Attach photo</button>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" disabled={!ok}
          onClick={() => ok && onConfirm(image ? { type: 'photo', value: image } : { type: 'text', value: text.trim() })}>Confirm</button>
      </div>
    </div>
  )
}

export function ProofView({ proof }: { proof: ProofEntry }) {
  return (
    <div className="proof-view fade-in">
      <span className="eyebrow live"><Lock size={10} /> Locked proof</span>
      {proof.type === 'photo' ? <img src={proof.value} alt="proof" /> : <p>{proof.value}</p>}
      <span className="mono muted">{new Date(proof.date).toLocaleString()}</span>
    </div>
  )
}

/** Days since a date (null-safe). */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** Re-render every `ms` (clocks, countdowns). */
export function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => set((x) => x + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])
}
