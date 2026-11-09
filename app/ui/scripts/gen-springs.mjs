// Writes the spring curves (CSS linear()) and the matching JS constants from one source.
//   node scripts/gen-springs.mjs          write both files
//   node scripts/gen-springs.mjs --check  exit 1 if either file differs from what would be written
// The math lives in src/ww/design/motion/springMath.ts (Node strips the types itself).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCss, buildTs } from '../src/ww/design/motion/springMath.ts'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ww/design/motion')
const targets = [
  [resolve(dir, 'springs.generated.css'), buildCss()],
  [resolve(dir, 'springs.generated.ts'), buildTs()],
]
const check = process.argv.includes('--check')
let drift = false
for (const [path, text] of targets) {
  if (check) {
    const have = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (have !== text) {
      console.error(`out of date: ${path}`)
      drift = true
    }
  } else {
    writeFileSync(path, text)
    console.log(`wrote ${path}`)
  }
}
if (drift) process.exit(1)
