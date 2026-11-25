// Builds the bundle the Playwright specs run against (dist-e2e, never dist). It sets VITE_LOOK_DEFAULT=off first:
// production builds default to the v3 look (shell/look.ts), but about 3,900 unit tests and most browser specs were written
// against the older frame, and a spec that wants v3 already says look=v3 in its fragment. One variable here costs less than
// rewriting them. A plain `vite build` (the real app) does not set it and gets v3. Extra arguments go to vite
// (for example `--outDir other`); VITE_ART_TRACK and the rest of the environment pass through unchanged.
import { spawnSync } from 'node:child_process'

const extra = process.argv.slice(2)
const args = ['vite', 'build', ...(extra.includes('--outDir') ? [] : ['--outDir', 'dist-e2e']), ...extra]
const r = spawnSync('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, VITE_LOOK_DEFAULT: 'off' } })
process.exit(r.status ?? 1)
