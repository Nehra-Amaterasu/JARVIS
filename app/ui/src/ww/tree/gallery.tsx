// The gallery states of T01: the Tree on invented rows (stamped SIMULATED by the fixture port's own state) and on the null adapter
// (WAITING). Loaded lazily by gallery/entries/T01.tsx, only where the build holds Well Wisher. The desk box is the real 1302 x 664
// canvas, drawn at 0.72; the phone states draw 358 px.
import { useMemo } from 'react'
import { STATES, STATE_MEANS, STATE_WORD } from './ledger'
import { TREES, type Tier } from './model'
import { FIXTURE_NOW, createFixturePort } from './fixtures'
import { SkillNode } from './SkillNode'
import { TreeView } from './TreeView'
import { nullPort } from './ports'
import './grove.css'

export type T01StateId = 'grove' | 'waiting' | 'tree' | 'drawer' | 'claimed' | 'stale' | 'nodes' | 'phone' | 'sheet'

const nodeAt = (t: string, b: number, n: number) => TREES().find((x) => x.id === t)!.branches[b].nodes[n].id

export function T01State({ state }: { state: T01StateId }) {
  const port = useMemo(() => (state === 'waiting' ? nullPort : createFixturePort()), [state])
  if (state === 'nodes') {
    return (
      <div className="tg-gallery-sheet" role="group" aria-label="The six node states on the three tiers">
        {([1, 2, 3] as Tier[]).map((tier) => (
          <div key={tier} style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {STATES.map((s) => (
              <figure key={s} style={{ margin: 0, textAlign: 'center', width: 128 }}>
                <svg viewBox="-64 -40 128 100" width="128" height="100" role="img" aria-label={`${STATE_WORD[s]}, tier ${tier}`}>
                  <SkillNode tier={tier} state={s} pips={s === 'evidenced' ? 3 : 0} label={`Tier ${tier}`} />
                </svg>
                <figcaption style={{ font: '600 11px/14px var(--font-mono)' }}>{STATE_WORD[s]}</figcaption>
                <figcaption style={{ font: '400 11px/14px var(--font-ui)', color: 'var(--ink-2)' }}>{STATE_MEANS[s]}</figcaption>
              </figure>
            ))}
          </div>
        ))}
      </div>
    )
  }
  const phone = state === 'phone' || state === 'sheet'
  const initial = state === 'tree' ? { tree: 'academic' }
    : state === 'drawer' ? { tree: 'academic', node: nodeAt('academic', 0, 2) }
    : state === 'claimed' ? { tree: 'academic', node: nodeAt('academic', 2, 0) }
    : state === 'stale' ? { tree: 'languages', node: nodeAt('languages', 1, 0) }
    : state === 'sheet' ? { tree: 'academic', node: nodeAt('academic', 1, 1) }
    : undefined
  return (
    <div className="tg-gallery-box" data-form={phone ? 'phone' : 'desk'} data-state={state}>
      <TreeView port={port} now={FIXTURE_NOW} form={phone ? 'phone' : 'desk'} initial={initial} />
    </div>
  )
}
