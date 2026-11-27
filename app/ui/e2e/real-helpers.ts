// Shared by the e2e/real-*.spec.ts files: the first run of the screens against the engine's REAL routes (the seeded sandbox,
// WW_SANDBOX_SEED=study, see playwright.config.ts). Nothing in those specs is mocked, so every comparison is "what the screen shows"
// against "what the same route answers when the test asks it", never against a number typed into a spec.
//
// A step that disagrees uses expect.soft: one run lists every disagreement instead of stopping at the first, which is the product of
// this package (the mismatch list). Every 4xx/5xx the page receives is logged too, because a screen that swallows a refusal looks fine.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

export const SEEDED = process.env.WW_SANDBOX_SEED === 'study'
export const PORT = Number(process.env.WW_SANDBOX_PORT ?? 8790)
export const SHOTS = resolve(process.env.REAL_SHOTS ?? resolve(tmpdir(), 'ui-real-shots'))
export const NEEDS_SEED = 'needs the seeded sandbox: WW_SANDBOX_SEED=study (see playwright.config.ts)'

/** The same route the screen calls, asked by the test with the sandbox token. */
export async function engine<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'x-jarvis-token': 'ww-e2e', 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  let body: any = null
  try { body = await res.json() } catch { /* an empty body */ }
  return { status: res.status, body }
}

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
}

/** Every refusal the page was given (method, path, status, the engine's detail), and every page error. Printed at the end of a test. */
export function watch(page: Page): { seen: string[]; report: (label: string) => void } {
  const seen: string[] = []
  page.on('response', async (r) => {
    if (r.status() < 400 || !r.url().includes('/api/')) return
    let d = ''
    try { d = JSON.stringify((await r.json())?.detail ?? '') } catch { /* no body */ }
    seen.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} ${d}`.trim())
  })
  page.on('pageerror', (e) => seen.push(`PAGE ERROR ${e.message}`))
  return { seen, report: (label) => { if (seen.length) test.info().annotations.push({ type: `refusals seen in ${label}`, description: seen.join(' | ') }); console.log(`[${label}] refusals the page received:`, seen.length ? `\n  ${seen.join('\n  ')}` : 'none') } }
}

export async function openApp(page: Page, baseURL: string | undefined, hash: string): Promise<void> {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 20_000 })
  await page.evaluate((h) => { location.hash = h }, hash)
  await expect(page.locator('.s2-page')).toBeVisible()
}

/** "2026-11-29T10:00:00Z" as the screen should write it in the viewer's own clock: "29 Nov 2026, 15:30". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function localStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`
}
export const RAW_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/
