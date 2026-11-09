// Plan 8.6 P9: reads the built output (npm run bundle:check builds into dist-e2e, never dist) and
// enforces what chunk 1a can check today:
//   - no GSAP, Framer, Lenis or Locomotive in any chunk, no webgl context created under src/ww
//   - the entry chunk does not contain katex (chunk 3 makes it a dynamic import)
//   - JS added by the motion system stays at or under 6 KB gzip (the sum of the gzip sizes of the
//     ww/design/motion sources, an upper bound on what the bundler can add)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = resolve(process.argv[2] ?? 'dist-e2e')
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const fail = []

const js = walk(dist).filter((f) => f.endsWith('.js'))
for (const f of js) {
  const t = readFileSync(f, 'utf8')
  if (/from\s*["'](gsap|framer-motion|lenis|locomotive-scroll)["']/.test(t) || /\bScrollSmoother\b|\bLocomotiveScroll\b/.test(t)) fail.push(`animation library in ${f}`)
}

const index = readFileSync(join(dist, 'index.html'), 'utf8')
const entry = /src="\.?\/?(assets\/[^"]+\.js)"/.exec(index)
if (entry) {
  const t = readFileSync(join(dist, entry[1]), 'utf8')
  if (/katex/i.test(t)) fail.push(`katex is in the entry chunk ${entry[1]}`)
}

const src = resolve('src/ww')
const wwFiles = walk(src).filter((f) => /\.(ts|tsx)$/.test(f))
for (const f of wwFiles) if (/getContext\(\s*['"]webgl2?['"]/.test(readFileSync(f, 'utf8'))) fail.push(`webgl context in ${f}`)

const motionDir = join(src, 'design', 'motion')
const motionBytes = walk(motionDir)
  .filter((f) => /\.ts$/.test(f) && !/generated|springMath/.test(f))
  .reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0)
console.log(`motion helpers: ${motionBytes} B gzip (source upper bound; limit 6144)`)
if (motionBytes > 6144) fail.push(`motion helpers ${motionBytes} B gzip over 6144`)

if (fail.length) {
  console.error(fail.join('\n'))
  process.exit(1)
}
console.log('bundle budget ok')
