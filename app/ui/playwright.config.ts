// Playwright for Well Wisher (plan 8.4, 8.6.1). Every run targets the SANDBOX, never the live app:
//   python -m jarvis_app.ww_sandbox --port 8790 --token ww-e2e   (cwd app/, scratch data dir)
// global-setup.ts refuses ports 8777 and 8778 and proves the target is the sandbox by calling a
// token-guarded route. Output goes to dist-e2e, never app/ui/dist (the live app serves that).
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { defineConfig } from '@playwright/test'

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

// A scratch data dir that already exists, so ww_sandbox does not copy the owner's data/app.
const SCRATCH = process.env.WW_SANDBOX_DIR ?? join(tmpdir(), 'jarvis-ww-e2e')
mkdirSync(SCRATCH, { recursive: true })

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
      command: `"${findPython()}" -m jarvis_app.ww_sandbox --port ${SANDBOX_PORT} --token ${SANDBOX_TOKEN} --dir "${SCRATCH}"`,
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
