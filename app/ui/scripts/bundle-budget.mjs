// Plan 8.6 P9: reads the built output (npm run bundle:check builds into dist-e2e, never dist) and
// enforces what chunk 1a can check today:
//   - no GSAP, Framer, Lenis or Locomotive in any chunk, no webgl context created under src/ww
//   - the entry chunk does not contain katex (chunk 3 makes it a dynamic import)
//   - one-product builds (seam cut B01): npm run bundle:check also builds VITE_PRODUCT=jarvis and =ww into
//     dist-e2e-jarvis / dist-e2e-ww and reads each build's product-modules.json (vite.config.ts): the ww
//     build holds no page, galaxy, twin or jarvis/ module and no three.js; the jarvis build holds no ww/ or
//     germoney/ module. A name check on the module list, not a string search over minified code.
//   - JS added by the motion system stays at or under 6 KB gzip (the sum of the gzip sizes of the
//     ww/design/motion sources, an upper bound on what the bundler can add)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'

const dist = resolve(process.argv[2] ?? 'dist-e2e')
const only = process.argv[3] // 'jarvis' | 'ww': the single-product build being checked (set by the parent run)
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

const FORBIDDEN = {
  ww: [/\/src\/(pages|galaxy|twin|jarvis)\//, /node_modules\/three\//],
  jarvis: [/\/src\/(ww|germoney)\//],
}
if (only) {
  const { modules } = JSON.parse(readFileSync(join(dist, 'product-modules.json'), 'utf8'))
  for (const re of FORBIDDEN[only] ?? []) {
    const hit = modules.filter((m) => re.test(m))
    if (hit.length) fail.push(`${only} build holds ${hit.length} module(s) of the other product, first ${hit[0]}`)
  }
  // Positive control: an empty or wrong module list used to pass silently (0 forbidden hits in 0 modules).
  const OWN = { ww: /\/src\/(ww|germoney)\//, jarvis: /\/src\/pages\// }
  const own = modules.filter((m) => OWN[only]?.test(m)).length
  if (!own) fail.push(`${only} build lists no module of its own tree (${modules.length} modules): the list is empty or wrong`)
  console.log(`${only} build: ${modules.length} modules, ${own} of its own tree`)
}

const motionDir = join(src, 'design', 'motion')
const motionBytes = walk(motionDir)
  .filter((f) => /\.ts$/.test(f) && !/generated|springMath/.test(f))
  .reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0)
console.log(`motion helpers: ${motionBytes} B gzip (source upper bound; limit 6144)`)
if (motionBytes > 6144) fail.push(`motion helpers ${motionBytes} B gzip over 6144`)

if (!only) {
  // The default run is the full build in dist-e2e; build and check each single-product build too.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  for (const product of ['jarvis', 'ww']) {
    const out = `dist-e2e-${product}`
    const b = spawnSync(npx, ['vite', 'build', '--outDir', out], { env: { ...process.env, VITE_PRODUCT: product }, stdio: 'inherit', shell: process.platform === 'win32' })
    if (b.status !== 0) fail.push(`${product} build failed`)
    else if (spawnSync(process.execPath, [process.argv[1], out, product], { stdio: 'inherit' }).status !== 0) fail.push(`${product} build over budget`)
  }
}

if (fail.length) {
  console.error(fail.join('\n'))
  process.exit(1)
}
console.log('bundle budget ok')
