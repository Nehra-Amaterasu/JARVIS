// A bright, busy stand-in desktop wallpaper, drawn in CSS: the worst case the glass is judged over (spec 2.7). DEMO ONLY: it
// is a fixture for the gallery, the e2e shots and the tests, and no screen of the app draws it. Colours live here, in a
// component, because the stylesheets may hold none.
import type { CSSProperties } from 'react'

const WALL: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  overflow: 'hidden',
  backgroundImage: [
    'radial-gradient(48% 52% at 14% 18%, #ffe83a 0, transparent 62%)',
    'radial-gradient(44% 56% at 86% 14%, #ff2f7d 0, transparent 64%)',
    'radial-gradient(46% 50% at 72% 88%, #10d0ff 0, transparent 62%)',
    'radial-gradient(40% 46% at 8% 92%, #6dff3d 0, transparent 62%)',
    'linear-gradient(118deg, #ffffff 0%, #ffd0e6 38%, #b9e8ff 100%)',
  ].join(', '),
}
const SHAPE: CSSProperties = { position: 'absolute', display: 'block' }
const SHAPES: CSSProperties[] = [
  { left: '6%', top: '48%', width: 220, height: 220, borderRadius: '50%', background: '#fff200', boxShadow: '0 0 0 22px #ff3b30, 0 0 0 44px #ffffff' },
  { left: '44%', top: -50, width: 280, height: 280, borderRadius: '50%', backgroundImage: 'conic-gradient(#ff0080, #ffd400, #00e0ff, #7a00ff, #ff0080)' },
  { right: -50, top: '46%', width: 320, height: 320, borderRadius: '50%', background: '#1b0a63', boxShadow: '0 0 0 26px #00e5ff' },
  { left: '30%', bottom: '6%', width: 420, height: 240, background: 'repeating-linear-gradient(90deg, #000 0 18px, #fff 18px 36px)', transform: 'rotate(-8deg)', opacity: 0.9 },
  { left: '60%', top: '12%', width: 130, height: 130, background: '#00c853', transform: 'rotate(22deg)' },
  { left: '18%', top: '6%', width: 100, height: 100, borderRadius: '50%', background: '#ff6d00', boxShadow: '0 0 0 14px #ffffff' },
]

/** `dark` is the second check of spec 2.7: the same wallpaper dimmed. The dark proof is the bright one. */
export function Wall({ dark }: { dark?: boolean }) {
  return (
    <div aria-hidden="true" data-wall={dark ? 'dark' : 'bright'} style={dark ? { ...WALL, filter: 'brightness(0.16)' } : WALL}>
      {SHAPES.map((s, i) => (
        <i key={i} style={{ ...SHAPE, ...s }} />
      ))}
    </div>
  )
}
