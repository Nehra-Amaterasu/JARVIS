// Playwright for Well Wisher (plan 8.4, 8.6.1). Every run targets the SANDBOX, never the live app:
//   python -m jarvis_app.ww_sandbox --port 8790 --token ww-e2e   (cwd app/, scratch data dir)
// global-setup.ts refuses ports 8777 and 8778 and proves the target is the sandbox by calling a
// token-guarded route. Output goes to dist-e2e, never app/ui/dist (the live app serves that).
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { defineConfig } from '@playwright/test'

// 26 spec files bundle a gallery page themselves with vite's build(), in this process, not from dist-e2e. Vite reads VITE_* from
// process.env, so the older-frame default has to be set here too: without it those pages rendered in the v3 look and 78 older-frame
// tests failed (19 spec files: 21 failures before the look default changed, 99 after; measured 27 Nov). A run may still override it.
process.env.VITE_LOOK_DEFAULT ??= 'off'

export const SANDBOX_PORT = Number(process.env.WW_SANDBOX_PORT ?? 8790)
export const PREVIEW_PORT = Number(process.env.WW_PREVIEW_PORT ?? 5174)
export const SANDBOX_TOKEN = 'ww-e2e'

/** The venv python: WW_PYTHON, else the nearest ancestor that has .venv (a worktree sits under the main checkout). */
function findPython(): string {
  if (process.env.WW_PYTHON) return process.env.WW_PYTHON
  let dir = resolve('.')
  for (let i = 0; i < 8; i++) {
    const p = join(dir, '.venv', 'Scripts', 'python.exe')
    if (existsSync(p)) return p
    if (dirname(dir) === dir) break
    dir = dirname(dir)
  }
  return 'python'
}

// WW_SANDBOX_SEED=study starts the sandbox in seed mode (`--seed study --fresh`): an empty folder filled with invented, shape-true rows
// by the engine's own code, so the REAL routes answer and the e2e/real-*.spec.ts files can run with no route mock. It is a switch and not
// the default because the 60-odd older specs mock their routes against the plain sandbox and some of them count on it being empty (no
// papers, Google off); --fresh makes every run start from the same rows, since a spec that presses a key writes to that folder.
// JARVIS_SANDBOX_OCR_DELAY (seconds a page, default 2) passes through the environment.
export const SEEDED = process.env.WW_SANDBOX_SEED === 'study'
const SEED_ARGS = SEEDED ? ' --seed study --fresh' : ''

// A scratch data dir that already exists, so ww_sandbox does not copy the owner's data/app.
const SCRATCH = process.env.WW_SANDBOX_DIR ?? join(tmpdir(), 'jarvis-ww-e2e')
mkdirSync(SCRATCH, { recursive: true })

// The bundle under test is built with VITE_LOOK_DEFAULT=off (npm run bundle:check, or node scripts/build-e2e.mjs): the production
// default is the v3 look, and most specs were written against the older frame. A spec that wants v3 puts look=v3 in its fragment.
const haveBuild = existsSync(resolve('dist-e2e', 'index.html'))

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    viewport: { width: 1366, height: 768 },
    colorScheme: 'dark',
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
  },
  webServer: [
    {
      command: `"${findPython()}" -m jarvis_app.ww_sandbox --port ${SANDBOX_PORT} --token ${SANDBOX_TOKEN} --dir "${SCRATCH}"${SEED_ARGS}`,
      cwd: resolve('..'),
      url: `http://127.0.0.1:${SANDBOX_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 90_000,
    },
    // The built UI is served only when `npm run bundle:check` (or vite build --outDir dist-e2e) has run.
    ...(haveBuild
      ? [
          {
            command: `npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
            url: `http://127.0.0.1:${PREVIEW_PORT}`,
            reuseExistingServer: true,
            env: { WW_API_TARGET: `http://127.0.0.1:${SANDBOX_PORT}` },
          },
        ]
      : []),
  ],
})
