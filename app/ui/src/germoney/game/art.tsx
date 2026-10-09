/**
 * Faces. Characters are holographic line busts (chrome on glass, a track-coloured
 * ring); bosses are red sigils whose outer ring IS their HP. All SVG, all drawn
 * here — no image files, nothing fetched.
 */
import type { JSX } from 'react'
import { NPCS, TRACKS, type NpcId } from './characters'

const INK = 'rgba(245,246,248,0.88)'
const INK2 = 'rgba(245,246,248,0.45)'

function Ticks({ r, n, tint }: { r: number; n: number; tint: string }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const long = i % 6 === 0
        const r0 = r - (long ? 5 : 2.5)
        return <line key={i} x1={60 + Math.cos(a) * r0} y1={60 + Math.sin(a) * r0} x2={60 + Math.cos(a) * r} y2={60 + Math.sin(a) * r}
          stroke={long ? tint : INK2} strokeWidth={long ? 1.4 : 0.8} />
      })}
    </g>
  )
}

/* Face parts shared by the human characters. */
const Head = () => <ellipse cx="60" cy="54" rx="19.5" ry="24" fill="url(#holo)" stroke={INK} strokeWidth="1.3" />
const Ears = () => (<g stroke={INK} strokeWidth="1.1" fill="url(#holo)"><ellipse cx="40.5" cy="56" rx="3" ry="5" /><ellipse cx="79.5" cy="56" rx="3" ry="5" /></g>)
const Neck = ({ w = 13 }: { w?: number }) => <path d={`M${60 - w / 2} 74 L${60 - w / 2} 86 L${60 + w / 2} 86 L${60 + w / 2} 74`} fill="url(#holo)" stroke={INK} strokeWidth="1.2" />
const Shoulders = ({ wide = 0 }: { wide?: number }) => (
  <path d={`M${8 - wide} 124 C ${14 - wide} 98, ${34 - wide / 2} 88, 50 86 L 70 86 C ${86 + wide / 2} 88, ${106 + wide} 98, ${112 + wide} 124 Z`}
    fill="url(#holo)" stroke={INK} strokeWidth="1.3" />
)
const Eyes = ({ y = 54, glow }: { y?: number; glow: string }) => (
  <g>
    <rect x="49" y={y - 1.4} width="7.5" height="2.8" rx="1.4" fill={glow} />
    <rect x="63.5" y={y - 1.4} width="7.5" height="2.8" rx="1.4" fill={glow} />
  </g>
)
const Nose = () => <path d="M60 57 L58 65 L61.5 65.5" fill="none" stroke={INK2} strokeWidth="1.1" strokeLinecap="round" />
const Mouth = ({ smile = 0 }: { smile?: number }) => <path d={`M54 70 Q60 ${70 + smile} 66 70`} fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
const Brows = ({ y = 48, tilt = 0 }: { y?: number; tilt?: number }) => (
  <g stroke={INK} strokeWidth="1.6" strokeLinecap="round">
    <path d={`M48 ${y + tilt} L57 ${y - tilt * 0.4}`} />
    <path d={`M63 ${y - tilt * 0.4} L72 ${y + tilt}`} />
  </g>
)

function Kruger({ glow }: { glow: string }) {
  return (
    <g>
      <Shoulders />
      {/* turtleneck */}
      <path d="M46 84 Q60 92 74 84 L74 90 Q60 98 46 90 Z" fill="rgba(245,246,248,0.12)" stroke={INK} strokeWidth="1.1" />
      <Neck />
      <Ears /><Head />
      {/* receding grey hair: sides and a thin crown */}
      <path d="M41 50 C 40 36, 46 29, 52 28 M79 50 C 80 36, 74 29, 68 28" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" opacity="0.75" />
      <path d="M50 30 Q60 26 70 30" fill="none" stroke={INK2} strokeWidth="1.4" strokeDasharray="2 2" />
      <Brows y={47} tilt={1.6} />
      {/* rectangular glasses */}
      <g fill="rgba(92,225,255,0.06)" stroke={INK} strokeWidth="1.2">
        <rect x="46.5" y="50" width="12" height="8" rx="1.5" /><rect x="61.5" y="50" width="12" height="8" rx="1.5" />
        <path d="M58.5 53 L61.5 53" />
      </g>
      <Eyes y={54} glow={glow} />
      <Nose />
      {/* close beard */}
      <path d="M42 60 C 44 74, 52 79, 60 79 C 68 79, 76 74, 78 60" fill="none" stroke={INK2} strokeWidth="2.2" strokeDasharray="1.5 1.8" />
      <Mouth smile={-0.5} />
    </g>
  )
}

function Weiss({ glow }: { glow: string }) {
  return (
    <g>
      <Shoulders wide={-4} />
      <path d="M50 86 L60 98 L70 86" fill="none" stroke={INK} strokeWidth="1.2" />
      <Neck w={11} />
      <Ears /><Head />
      {/* bun + swept fringe */}
      <circle cx="60" cy="25" r="7.5" fill="rgba(245,246,248,0.16)" stroke={INK} strokeWidth="1.3" />
      <path d="M40.5 54 C 38 34, 50 26, 62 28 C 74 29, 82 38, 79.5 54 C 76 42, 66 36, 52 40 C 47 42, 43 47, 40.5 54 Z" fill="rgba(245,246,248,0.18)" stroke={INK} strokeWidth="1.2" />
      <Brows y={47} tilt={-0.8} />
      <Eyes y={54} glow={glow} />
      <Nose />
      <Mouth smile={2.6} />
      <circle cx="40.5" cy="63" r="1.6" fill={glow} /><circle cx="79.5" cy="63" r="1.6" fill={glow} />
    </g>
  )
}

function Rhea({ glow }: { glow: string }) {
  return (
    <g>
      {/* long hair behind the shoulders */}
      <path d="M38 50 C 34 72, 34 92, 40 104 L 80 104 C 86 92, 86 72, 82 50 Z" fill="rgba(245,246,248,0.12)" stroke={INK2} strokeWidth="1.1" />
      <Shoulders wide={-2} />
      {/* blazer lapels */}
      <path d="M48 87 L56 104 L60 92 L64 104 L72 87" fill="none" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <Neck w={11} />
      <Ears /><Head />
      <path d="M40.5 52 C 39 33, 50 27, 60 27 C 70 27, 81 33, 79.5 52 C 74 40, 64 33, 56 35 C 50 37, 44 43, 40.5 52 Z" fill="rgba(245,246,248,0.2)" stroke={INK} strokeWidth="1.2" />
      <Brows y={47.5} tilt={-0.4} />
      <Eyes y={54.5} glow={glow} />
      <Nose />
      <Mouth smile={1.8} />
    </g>
  )
}

function Chancellor({ glow }: { glow: string }) {
  return (
    <g>
      <Shoulders wide={2} />
      {/* high coat collar + bow tie */}
      <path d="M44 84 L50 96 L60 88 L70 96 L76 84" fill="none" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M54 90 L60 93 L54 96 Z M66 90 L60 93 L66 96 Z" fill={glow} opacity="0.85" />
      <Neck />
      <Ears /><Head />
      {/* bald crown sheen */}
      <path d="M50 34 Q60 29 70 34" fill="none" stroke={INK2} strokeWidth="1.2" />
      {/* heavy brows */}
      <g stroke={INK} strokeWidth="3" strokeLinecap="round"><path d="M47 46.5 L57 48.5" /><path d="M63 48.5 L73 46.5" /></g>
      {/* round spectacles */}
      <g fill="rgba(92,225,255,0.06)" stroke={INK} strokeWidth="1.2"><circle cx="52.5" cy="54.5" r="5.2" /><circle cx="67.5" cy="54.5" r="5.2" /><path d="M57.7 54 L62.3 54" /></g>
      <Eyes y={54.5} glow={glow} />
      <Nose />
      <Mouth smile={-1.6} />
    </g>
  )
}

function Brandt({ glow }: { glow: string }) {
  return (
    <g>
      <Shoulders wide={6} />
      {/* whistle lanyard */}
      <path d="M48 87 L60 104 L72 87" fill="none" stroke={INK2} strokeWidth="1.1" />
      <rect x="57" y="103" width="6" height="4" rx="1.5" fill={glow} />
      <Neck w={18} />
      <Ears /><Head />
      {/* buzz cut */}
      <path d="M41 50 C 40 35, 49 29, 60 29 C 71 29, 80 35, 79 50 C 74 42, 66 38, 60 38 C 54 38, 46 42, 41 50 Z" fill="rgba(245,246,248,0.1)" stroke={INK} strokeWidth="1.1" strokeDasharray="1 1.2" />
      <Brows y={47.5} tilt={0.6} />
      <Eyes y={54.5} glow={glow} />
      <Nose />
      <path d="M43 62 C 46 76, 54 80, 60 80 C 66 80, 74 76, 77 62" fill="none" stroke={INK2} strokeWidth="1.6" strokeDasharray="0.8 1.6" />
      <Mouth smile={0.6} />
    </g>
  )
}

function JarvisCore({ glow }: { glow: string }) {
  return (
    <g className="pt-core">
      <circle cx="60" cy="60" r="34" fill="none" stroke={INK2} strokeWidth="1" />
      <circle cx="60" cy="60" r="26" fill="none" stroke={glow} strokeWidth="1.4" strokeDasharray="18 6" className="pt-spin" />
      <circle cx="60" cy="60" r="18" fill="none" stroke={INK} strokeWidth="1.2" strokeDasharray="4 4" className="pt-spin-rev" />
      <circle cx="60" cy="60" r="9" fill={glow} opacity="0.85" />
      <circle cx="60" cy="60" r="13" fill="none" stroke={glow} strokeWidth="0.8" opacity="0.6" />
    </g>
  )
}

const FACES: Record<NpcId, (p: { glow: string }) => JSX.Element> = {
  jarvis: JarvisCore, kruger: Kruger, weiss: Weiss, rhea: Rhea, chancellor: Chancellor, brandt: Brandt,
}

export function Portrait({ npc, size = 64, speaking = false }: { npc: NpcId; size?: number; speaking?: boolean }) {
  const n = NPCS[npc]
  const tint = n.track ? TRACKS[n.track].tint : '#5ce1ff'
  const Face = FACES[npc]
  const id = `p-${npc}`
  return (
    <svg className={`portrait ${speaking ? 'speaking' : ''}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${n.name}, ${n.role}`}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="40%" r="62%">
          <stop offset="0%" stopColor={tint} stopOpacity="0.32" />
          <stop offset="70%" stopColor={tint} stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="holo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.03" />
        </linearGradient>
        <pattern id={`${id}-scan`} width="4" height="3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1" fill="#fff" opacity="0.05" />
        </pattern>
        <clipPath id={`${id}-clip`}><circle cx="60" cy="60" r="52" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="56" fill="rgba(10,11,13,0.9)" stroke="rgba(255,255,255,0.12)" />
      <Ticks r={58.5} n={48} tint={tint} />
      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="60" cy="60" r="52" fill={`url(#${id}-bg)`} />
        <Face glow={tint} />
        <rect x="0" y="0" width="120" height="120" fill={`url(#${id}-scan)`} />
      </g>
      <circle cx="60" cy="60" r="52" fill="none" stroke={tint} strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  )
}

/* ------------------------------------------------------------------ boss sigils */
export function Sigil({ sides, horns, eyes, glyph, size = 96, hp = 1, defeated = false, escaped = false }:
  { sides: number; horns: number; eyes: number; glyph: string; size?: number; hp?: number; defeated?: boolean; escaped?: boolean }) {
  const RED = defeated ? 'rgba(245,246,248,0.35)' : '#ff453a'
  const poly = (r: number, rot: number) => Array.from({ length: sides }, (_, i) => {
    const a = rot + (i / sides) * Math.PI * 2 - Math.PI / 2
    return `${60 + Math.cos(a) * r},${60 + Math.sin(a) * r}`
  }).join(' ')
  const C = 2 * Math.PI * 55
  const eyeW = eyes > 2 ? 6 : 9
  const gap = 4
  const total = eyes * eyeW + (eyes - 1) * gap
  return (
    <svg className={`sigil ${defeated ? 'defeated' : ''} ${escaped ? 'escaped' : ''}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Boss sigil ${glyph}`}>
      <defs>
        <radialGradient id={`sg-${glyph}`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={RED} stopOpacity={defeated ? 0.05 : 0.28} />
          <stop offset="100%" stopColor={RED} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* HP ring */}
      <circle cx="60" cy="60" r="55" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle cx="60" cy="60" r="55" fill="none" stroke={RED} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${C * Math.max(0, Math.min(1, hp))} ${C}`} transform="rotate(-90 60 60)" className="sigil-hp" />
      <circle cx="60" cy="60" r="48" fill={`url(#sg-${glyph})`} />
      {/* horns */}
      {Array.from({ length: horns / 2 }, (_, k) => {
        const off = 10 + k * 9
        return (
          <g key={k} fill="none" stroke={RED} strokeWidth="1.6" strokeLinecap="round">
            <path d={`M${60 - off} 34 Q ${60 - off - 10} ${20 - k * 4} ${60 - off - 4} ${10 - k * 3}`} />
            <path d={`M${60 + off} 34 Q ${60 + off + 10} ${20 - k * 4} ${60 + off + 4} ${10 - k * 3}`} />
          </g>
        )
      })}
      <polygon points={poly(38, 0)} fill="rgba(10,11,13,0.85)" stroke={RED} strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points={poly(29, Math.PI / sides)} fill="none" stroke={RED} strokeOpacity="0.55" strokeWidth="1" />
      {/* eyes */}
      <g fill={RED} className={defeated ? '' : 'sigil-eyes'}>
        {Array.from({ length: eyes }, (_, i) => (
          <rect key={i} x={60 - total / 2 + i * (eyeW + gap)} y="52" width={eyeW} height="3" rx="1.5" transform={`skewX(${i < eyes / 2 ? -14 : 14})`} transform-origin="60 53" />
        ))}
      </g>
      <text x="60" y="76" textAnchor="middle" fontFamily="var(--f-mono)" fontSize="10" letterSpacing="1.5" fill={RED} opacity="0.9">{glyph}</text>
      {defeated && <path d="M30 30 L90 90" stroke="rgba(245,246,248,0.55)" strokeWidth="2" />}
    </svg>
  )
}
