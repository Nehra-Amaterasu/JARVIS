// Shared helpers for the Well Wisher specs (plan 8.6.1).
//
// The "lab" is a static page built from the real design CSS (base.css and everything it imports,
// flattened) plus a few elements that carry the classes and data attributes of the 12 motions. It
// lets chunk 1a prove the token layer in a real Chromium before any Well Wisher page exists.
// Specs that need a real page (hit areas, screenshots, keyboard order, carcass, frame traces)
// skip with a stated reason until the chunk that creates the page has merged.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'

const DESIGN = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ww/design')

/** base.css with its @imports inlined, in order. */
export function designCss(): string {
  const baseCss = readFileSync(resolve(DESIGN, 'base.css'), 'utf8')
  const imports = [...baseCss.matchAll(/@import\s+'([^']+)'/g)].map((m) => readFileSync(resolve(DESIGN, m[1]), 'utf8'))
  return imports.join('\n') + '\n' + baseCss.replace(/@import[^;]+;/g, '')
}

const LAB_BODY = `
<div class="ww" id="root" style="padding:16px">
  <button class="ww-tap" id="tap" style="min-width:120px;min-height:44px">Tap</button>
  <div class="ww-lift" id="lift"><div class="ww-lift-face" style="position:relative;padding:12px">Lift</div></div>
  <div id="holdwrap"><div class="ww-hold-fill" style="height:4px;background:currentColor"></div></div>
  <div class="ww-fill" id="fill" style="--v:0.3;width:200px;height:4px;background:currentColor"></div>
  <div class="ww-centre" id="centre" data-ws="study" style="min-height:200px">
    <h1 class="ww-pin-title" id="title" style="margin:0">Title</h1>
    <div class="ww-pin-rule" style="height:1px;background:currentColor"></div>
    <div id="c1">one</div><div id="c2">two</div><div id="c3">three</div>
  </div>
  <aside class="ww-sheet" id="sheet" data-state="closed" style="position:fixed;right:0;top:0;width:320px;height:100%;background:var(--surface-3)">sheet</aside>
  <div class="ww-scrim" id="scrim" data-state="closed"></div>
  <div class="ww-popover" id="popover" data-state="closed">popover</div>
  <div id="celebrate">ok</div>
</div>`

export type HtmlAttrs = Record<string, string>

/** Load the lab. `html` sets attributes on <html> (data-theme, data-motion, ...). */
export async function openLab(page: Page, html: HtmlAttrs = {}): Promise<void> {
  await page.addInitScript(() => {
    // count rAF callbacks so the idle checks can prove "0 callbacks after the last input"
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    // scroll-driven animations (the pin header) are always 'running' by design; only time-based ones count
    ;(window as unknown as { __anims: () => Animation[] }).__anims = () =>
      (document as unknown as { getAnimations(o: object): Animation[] }).getAnimations({ subtree: true }).filter((a) => a.timeline instanceof DocumentTimeline)
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__raf++
      return orig(cb)
    }
  })
  await page.goto('about:blank') // the init script above runs on this navigation; setContent then keeps the window
  const attrs = Object.entries({ 'data-ww': '', ...html })
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  await page.setContent(`<!doctype html><html ${attrs}><head><meta charset="utf-8"><style>${designCss()}</style></head><body style="margin:0">${LAB_BODY}</body></html>`)
}

export const setHtmlAttr = (page: Page, name: string, value: string | null) =>
  page.evaluate(([n, v]) => (v === null ? document.documentElement.removeAttribute(n) : document.documentElement.setAttribute(n, v)), [name, value] as const)

export interface Anim {
  name: string
  duration: number
  delay: number
  props: string[]
  transforms: string[]
  target: string
}

/** Everything animating or transitioning right now, with the properties and transforms it touches. */
export const snapshotAnimations = (page: Page): Promise<Anim[]> =>
  page.evaluate(() =>
    (window as unknown as { __anims(): Animation[] }).__anims().map((a) => {
      const eff = a.effect as KeyframeEffect
      const kfs = eff.getKeyframes()
      return {
        name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? '',
        duration: Number(eff.getTiming().duration),
        delay: Number(eff.getTiming().delay ?? 0),
        props: [...new Set(kfs.flatMap((k) => Object.keys(k)).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)))],
        transforms: kfs.map((k) => String((k as unknown as Record<string, unknown>).transform ?? 'none')),
        target: (eff.target as Element | null)?.id ?? '',
      }
    }),
  )

/** True if a CSS transform value moves, scales or rotates nothing. */
export function isIdentityTransform(t: string): boolean {
  const rest = t.replace(/translate[XYZ]?\(\s*-?0(px|%)?\s*(,\s*-?0(px|%)?\s*)?\)/g, '').replace(/scale\(\s*1\s*\)/g, '').replace(/matrix\(1, 0, 0, 1, 0, 0\)/g, '')
  return rest.trim() === '' || rest.trim() === 'none'
}

/** The motions of plan 5.7.3 that CSS can start from an attribute, each with a target and the attribute to set. */
export const MOTIONS: { id: string; budgetMs: number; start: (page: Page) => Promise<void> }[] = [
  { id: 'arrive', budgetMs: 240 + 80, start: (p) => p.evaluate(() => ['c1', 'c2', 'c3'].forEach((id, i) => { const e = document.getElementById(id)!; e.style.setProperty('--i', String(i)); e.setAttribute('data-arrive', 'in') })) },
  { id: 'switch-fade', budgetMs: 160, start: (p) => p.evaluate(() => document.getElementById('centre')!.setAttribute('data-switch', 'fade')) },
  { id: 'sheet', budgetMs: 300, start: (p) => p.evaluate(() => document.getElementById('sheet')!.setAttribute('data-state', 'open')) },
  { id: 'scrim', budgetMs: 240, start: (p) => p.evaluate(() => document.getElementById('scrim')!.setAttribute('data-state', 'open')) },
  { id: 'popover', budgetMs: 160, start: (p) => p.evaluate(() => document.getElementById('popover')!.setAttribute('data-state', 'open')) },
  { id: 'celebrate', budgetMs: 400, start: (p) => p.evaluate(() => document.getElementById('celebrate')!.setAttribute('data-celebrate', 'on')) },
  { id: 'hold', budgetMs: 400, start: (p) => p.evaluate(() => document.getElementById('holdwrap')!.setAttribute('data-hold', 'holding')) },
]

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export { base as test, expect }
