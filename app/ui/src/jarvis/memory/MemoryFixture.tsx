// The Memory views on stamped fixtures: the gallery entry, the jury page and the tests mount these. Every state is drawn
// from a port with `simulated: true`, so each lamp says SIMULATED and no fixture number passes as measured.
import { useEffect } from 'react'
import { BeliefsView } from './Beliefs'
import { KeepView } from './Keep'
import { PeopleView } from './People'
import { RecallView, type RecallTab } from './Recall'
import { recallStore } from './hooks'
import { NOW_MS, NOW_S, fixtureBeliefPort, fixturePeoplePort, fixtureRecallPort, fixtureRemindersPort, fixtureReviewPort, fixtureSourcesPort, type FixtureOptions } from './fixtures'
import type { Recall } from './model'

export type MemoryFixtureKind = 'recall' | 'recall-lit' | 'recall-many' | 'recall-empty' | 'recall-delete' | 'strata' | 'trail' | 'results' | 'beliefs' | 'people' | 'keep'

const TRAIL: Recall[] = [
  { n: 1, q: 'the spare key', at: NOW_MS - 9e6, hits: 3 }, { n: 2, q: 'notes folder', at: NOW_MS - 8e6, hits: 5 }, { n: 3, q: 'market stall', at: NOW_MS - 7e6, hits: 0 },
  { n: 4, q: 'library books', at: NOW_MS - 6e6, hits: 2 }, { n: 5, q: 'basil', at: NOW_MS - 5e6, hits: 6 }, { n: 6, q: 'long route', at: NOW_MS - 4e6, hits: 4 },
]

export function MemoryFixture({ kind }: { kind: MemoryFixtureKind }) {
  useEffect(() => {
    recallStore.set(kind === 'trail' || kind === 'strata' ? TRAIL : [])
    return () => recallStore.set([])
  }, [kind])
  const opts: FixtureOptions = kind === 'recall-many' ? { count: 340 } : kind === 'recall-empty' ? { empty: true } : kind === 'recall-delete' ? { deletable: true } : {}
  const tab: RecallTab = kind === 'strata' ? 'strata' : kind === 'trail' ? 'trail' : kind === 'results' ? 'results' : 'const'
  switch (kind) {
    case 'beliefs': return <BeliefsView port={fixtureBeliefPort()} now={NOW_S} />
    case 'people': return <PeopleView port={fixturePeoplePort} now={NOW_MS} />
    case 'keep': return <KeepView recall={fixtureRecallPort()} sources={fixtureSourcesPort} review={fixtureReviewPort} simulated now={NOW_S} />
    default:
      return (
        <RecallView
          key={kind} port={fixtureRecallPort(opts)} reminders={fixtureRemindersPort} tab={tab} now={NOW_S}
          initialQuery={kind === 'recall-lit' || kind === 'results' ? 'the spare key' : null}
        />
      )
  }
}
