// X03 on the gallery (the states; gallery/entries/X03.tsx loads this file lazily behind the product gate, so a JARVIS only build carries
// none of it): the practice-paper maker, its parts and the printed sheets, every state on INVENTED blueprints and questions. The fixtures
// are in ww/study/generator/fixtures.ts, never a real paper; every reading drawn from them is stamped SIMULATED, and the null adapter's own
// empty state (WAITING) is shown beside them. Nothing here reads a route.
import type { ReactNode } from 'react'
import { nullStudyPort } from '../adapters/null.register'
import { BlueprintTable } from './BlueprintTable'
import { GeneratorDesk, type GeneratorDeskProps } from './GeneratorDesk'
import { PaperSkeleton } from './PaperSkeleton'
import { PrintSheet } from './PrintSheet'
import { SlotStrip } from './SlotStrip'
import { BLUEPRINT_BALANCED, BLUEPRINT_SEVEN, BLUEPRINT_UNBALANCED, FIXTURE_BLUEPRINTS, fixtureDraw, fixtureExtras, fixturePort } from './fixtures'
import { toGen, type GeneratorPort, type PaperSection, type Slot } from './model'
import './generator.css'

const sim = fixturePort()
const withModel = fixturePort(FIXTURE_BLUEPRINTS, { withModel: true })
const seven = fixturePort([BLUEPRINT_SEVEN])
const none: GeneratorPort = nullStudyPort as unknown as GeneratorPort

const Box = ({ children }: { children: ReactNode }) => <div className="x03-box">{children}</div>
const Desk = (p: GeneratorDeskProps) => <Box><GeneratorDesk {...p} /></Box>

const BP = toGen(BLUEPRINT_BALANCED)
const PAPER = fixtureDraw(BP, 48271)
const SLOTS: Slot[] = [
  { ...PAPER.sections![0].slots[0], source: 'hand', textStatus: 'verified', reason: 'a question you accepted yourself' },
  { ...PAPER.sections![0].slots[1], source: 'rule', reason: 'highest gain in Unit 3; not attempted for 18 days' },
  { ...PAPER.sections![0].slots[2], source: 'template', reason: 'a numerical filled from a template; the numbers differ from the original' },
  { ...PAPER.sections![1].slots[1], source: 'model', textStatus: 'unverified', reason: 'a model draft of an earlier question: not yet your decision' },
  PAPER.sections![2].slots[2],
]
const STRIP: PaperSection[] = [{ name: 'Section A', marks: 2, attempt: 5, set: 5, choice: 'all', slots: SLOTS }]

export const X03_STATES = 16

export function X03State({ index }: { index: number }) {
  switch (index) {
    case 0: return <Desk port={sim} extras={fixtureExtras} />
    case 1: return <Desk port={sim} extras={fixtureExtras} initial={{ blueprintId: 'bp-b' }} />
    case 2: return <Desk port={none} />
    case 3: return <Desk port={none} extras={fixtureExtras} initial={{ infer: true }} />
    case 4: return <Desk port={seven} extras={fixtureExtras} />
    case 5: return <Desk port={sim} extras={fixtureExtras} initial={{ step: 'slots' }} />
    case 6: return <Desk port={withModel} extras={fixtureExtras} initial={{ step: 'slots' }} />
    case 7: return <Desk port={sim} extras={fixtureExtras} initial={{ step: 'print', kind: 'paper' }} />
    case 8: return <Desk port={sim} extras={fixtureExtras} initial={{ step: 'print', kind: 'key' }} />
    case 9: return <Desk port={sim} extras={fixtureExtras} initial={{ step: 'print', kind: 'marking' }} />
    case 10: return (
      <div className="x03-part" style={{ inlineSize: 900 }}>
        <BlueprintTable sections={BP.sections} total={60} duration={120} state="simulated" reason="invented blueprint" onChange={() => undefined} />
      </div>
    )
    case 11: return (
      <div className="x03-part" style={{ inlineSize: 900 }}>
        <BlueprintTable sections={toGen(BLUEPRINT_UNBALANCED).sections} total={60} duration={120} state="simulated" reason="invented blueprint" issues={[{ code: 'total', section: null, text: 'The sections add up to 55 marks, the total says 60 (5 short).' }]} onChange={() => undefined} />
      </div>
    )
    case 12: return <div className="x03-part" style={{ inlineSize: 900 }}><SlotStrip sections={STRIP} state="simulated" reason="invented questions" onSwap={() => undefined} onReseed={() => undefined} /></div>
    case 13: return <div className="x03-part" style={{ inlineSize: 360 }}><PaperSkeleton blueprint={BP} /></div>
    case 14: return <div className="x03-sheet"><PrintSheet paper={PAPER} kind="paper" stamp="SIMULATED" /></div>
    default: return <div className="x03-sheet"><PrintSheet paper={PAPER} kind="all" stamp="SIMULATED" /></div>
  }
}
