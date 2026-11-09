// Refuses to run against the live app. Port 8777 is the real app and 8778 its phone listener;
// the sandbox is the only server a Well Wisher test may talk to. /api/health answers only "ok"
// and the version, so it cannot tell a sandbox from the real app: the proof is a token-guarded
// route (/api/core) with the sandbox token, which the live app does not know and answers 401.
import type { FullConfig } from '@playwright/test'

const FORBIDDEN = new Set([8777, 8778])

export default async function globalSetup(_config: FullConfig) {
  const port = Number(process.env.WW_SANDBOX_PORT ?? 8790)
  if (FORBIDDEN.has(port)) throw new Error(`refusing to run: port ${port} is the live app`)
  const target = process.env.WW_API_TARGET
  if (target && FORBIDDEN.has(Number(new URL(target).port))) throw new Error(`refusing to run: WW_API_TARGET ${target} is the live app`)
  const res = await fetch(`http://127.0.0.1:${port}/api/core`, { headers: { 'x-jarvis-token': 'ww-e2e' } })
  if (res.status !== 200) throw new Error(`port ${port} does not accept the sandbox token (HTTP ${res.status}); it is not the sandbox`)
}
