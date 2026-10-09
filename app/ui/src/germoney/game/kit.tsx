/**
 * The game's small parts: level ring, HP bar, streak flame, Marks, shields,
 * the attribute radar, track tags and the Intel card. Shared by every Mission tab.
 */
import { Eye, Flame, Lightbulb, Shield } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { TRACKS, type Track } from './characters'
import type { Intel } from './contracts'

export function Marks({ n, size = 'md' }: { n: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`marks ${size}`} title="Marks — the currency you spend in the Armory">
      <i>DM</i><b className="dot">{n.toLocaleString('en-IN')}</b>
    </span>
  )
}

export function StreakFlame({ n, kept }: { n: number; kept: boolean }) {
  return (
    <span className={`streak ${kept ? 'kept' : 'open'} ${n >= 7 ? 'hot' : ''}`} title={kept ? 'Today is secured' : 'Today is not secured yet'}>
      <Flame size={18} /><b className="dot">{n}</b>
    </span>
  )
}

export function Shields({ n, max = 3 }: { n: number; max?: number }) {
  return (
    <span className="shields" title={`${n} shield${n === 1 ? '' : 's'}: each covers one missed day`}>
      {Array.from({ length: max }, (_, i) => <Shield key={i} size={14} className={i < n ? 'on' : ''} />)}
    </span>
  )
}

export function XpRing({ level, progress, size = 132 }: { level: number; progress: number; size?: number }) {
  const r = 54
  const C = 2 * Math.PI * r
  return (
    <svg className="xp-ring" width={size} height={size} viewBox="0 0 128 128" aria-label={`Level ${level}`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="url(#xpGrad)" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${C * Math.max(0.002, Math.min(1, progress))} ${C}`} transform="rotate(-90 64 64)" className="xp-arc" />
      <defs>
        <linearGradient id="xpGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" /><stop offset="45%" stopColor="#c9ced6" /><stop offset="100%" stopColor="#7d838d" />
        </linearGradient>
      </defs>
      {Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2 - Math.PI / 2
        return <line key={i} x1={64 + Math.cos(a) * 44} y1={64 + Math.sin(a) * 44} x2={64 + Math.cos(a) * 47} y2={64 + Math.sin(a) * 47} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      })}
      <text x="64" y="58" textAnchor="middle" className="xp-ring-k">LEVEL</text>
      <text x="64" y="86" textAnchor="middle" className="xp-ring-n">{level}</text>
    </svg>
  )
}

export function HpBar({ hp, max, segments = 20 }: { hp: number; max: number; segments?: number }) {
  const lit = Math.ceil((hp / Math.max(1, max)) * segments)
  return (
    <div className="hp-bar" role="meter" aria-valuenow={hp} aria-valuemax={max} aria-label="Boss HP">
      {Array.from({ length: segments }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
    </div>
  )
}

export function TrackTag({ track }: { track: Track }) {
  const t = TRACKS[track]
  return <span className="track-tag" style={{ '--tint': t.tint } as CSSProperties}>{t.short}</span>
}

export function Radar({ values }: { values: Record<string, number> }) {
  const keys = Object.keys(values)
  const R = 46
  const pt = (i: number, v: number) => {
    const a = (i / keys.length) * Math.PI * 2 - Math.PI / 2
    return [60 + Math.cos(a) * R * v, 60 + Math.sin(a) * R * v]
  }
  const shape = keys.map((k, i) => pt(i, values[k] / 100).join(',')).join(' ')
  return (
    <svg className="radar" viewBox="0 0 120 120" aria-label="Attributes">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={keys.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,0.08)" />
      ))}
      {keys.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1="60" y1="60" x2={x} y2={y} stroke="rgba(255,255,255,0.06)" /> })}
      <polygon points={shape} fill="rgba(92,225,255,0.14)" stroke="var(--live)" strokeWidth="1.4" strokeLinejoin="round" className="radar-shape" />
      {keys.map((k, i) => {
        const [x, y] = pt(i, 1.22)
        return <text key={k} x={x} y={y + 3} textAnchor="middle" className="radar-k">{k}</text>
      })}
    </svg>
  )
}

/** Why it matters · the concept · one resource · a check question you answer before revealing. */
export function IntelCard({ intel, why }: { intel: Intel; why?: string }) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="intel-card fade-in">
      {(intel.why ?? why) && <p className="ic-why"><span className="eyebrow">Why it matters</span>{intel.why ?? why}</p>}
      <p className="ic-concept"><span className="eyebrow"><Lightbulb size={11} /> Concept</span>{intel.concept}</p>
      {intel.resource && <a className="ic-res" href={intel.resource.url} target="_blank" rel="noreferrer">{intel.resource.label} ↗</a>}
      {intel.check && (
        <div className="ic-check">
          <span className="eyebrow">Check yourself</span>
          <p>{intel.check.q}</p>
          {reveal ? <p className="ic-answer fade-in">{intel.check.a}</p>
            : <button className="btn sm ghost" onClick={() => setReveal(true)}><Eye size={12} />Answer first in your head — then reveal</button>}
        </div>
      )}
    </div>
  )
}
