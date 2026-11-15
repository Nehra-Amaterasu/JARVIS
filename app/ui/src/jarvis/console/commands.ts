// What each closed verb of the Console command line does (spec 20.9.5). A verb maps to a route the app already has or
// reads what is already on the screen; there is no shell, no eval and no passthrough, so a typed word that is not in
// VERBS never reaches this file (the Capture Line refuses it first). Each function returns plain lines: a tag, a lamp
// state and the words. A verb whose route is not built says so as PLANNED instead of pretending.
import { barTrack } from '../../shared/grammar'
import type { LampState } from '../../shared/lamp'
import { LAMP_SPECS } from '../../shared/lamp'
import type { PlannedEntry } from '../../shared/planned/types'
import { VERBS, routePlates, validFraction, type ConsoleRowData, type JobSpec, PLATE_WORD } from './model'

export interface OutLine {
  id: number
  tag: string
  state: LampState | null
  text: string
  /** An echoed command (drawn with the prompt), an answer, or the question a heavy verb asks. */
  kind: 'echo' | 'out' | 'ask'
}

export interface CommandContext {
  rows: () => ConsoleRowData[]
  jobs: () => JobSpec[]
  plan: () => readonly PlannedEntry[]
  restartBrain: () => Promise<string>
  freeGpu: () => Promise<string>
  /** Null until a route writes the memory export: the verb then answers PLANNED. */
  exportMemory: (() => Promise<string>) | null
  openPlan?: () => void
}

type Raw = Omit<OutLine, 'id'>
const out = (tag: string, state: LampState | null, text: string): Raw => ({ tag, state, text, kind: 'out' })

/** The one question a heavy verb asks before it runs. */
export function askLine(verb: string): Raw {
  const what: Record<string, string> = {
    'restart brain': 'stop and start the brain: a spoken answer in flight is cut',
    'free gpu': 'unload every model from the GPU: the next question reloads the brain',
    'export memory': 'write the memory export to the exports folder',
  }
  return { tag: 'SYS', state: null, kind: 'ask', text: `${verb}: ${what[verb] ?? 'this changes something'}. Run it?` }
}

const fmtJob = (j: JobSpec): string => {
  const f = validFraction(j.fraction) && (j.state === 'live' || j.state === 'done') ? j.fraction : null
  const { fill, empty } = barTrack(f, 12)
  return `${j.label}  [${fill}${empty}] ${f === null ? '--' : `${Math.round(f * 100)} %`}${j.reason ? `  ${j.reason}` : ''}`
}

/** A verb that only reads: the answer is immediate. */
export function readVerb(verb: string, ctx: CommandContext): Raw[] {
  switch (verb) {
    case 'status': return ctx.rows().map((r) => out(r.tag, r.reading.state, `${r.text}${r.reading.reason ? `, ${r.reading.reason}` : ''}`))
    case 'test hearing': {
      const r = ctx.rows().find((x) => x.tag === 'HEA')
      return [
        out('HEA', r?.reading.state ?? 'waiting', r ? `${r.text}${r.reading.reason ? `, ${r.reading.reason}` : ''}` : 'not tested'),
        out('SYS', 'waiting', 'this reads the core now; it plays no sound and listens to no one'),
      ]
    }
    case 'jobs': {
      const js = ctx.jobs()
      return js.length ? js.map((j) => out(j.tag, j.state === 'fault' ? 'fault' : j.state === 'hollow' ? 'waiting' : 'live', fmtJob(j))) : [out('SYS', 'waiting', 'no job is running')]
    }
    case 'plan': {
      const ps = routePlates(ctx.plan())
      ctx.openPlan?.()
      return ps.length
        ? [out('SYS', 'planned', `${ps.length} item${ps.length === 1 ? '' : 's'} on the route; the roadmap is open`), ...ps.slice(0, 4).map((p) => out('PLN', p.state === 'passed' ? 'live' : p.state === 'waiting' ? 'waiting' : 'planned', `${p.label}: ${PLATE_WORD[p.state].toLowerCase()}`))]
        : [out('SYS', 'waiting', 'nothing is registered as planned')]
    }
    case 'help': return [
      out('SYS', null, `read: ${VERBS.filter((v) => !v.heavy).map((v) => v.verb).join(', ')}`),
      out('SYS', null, `change, asks once: ${VERBS.filter((v) => v.heavy).map((v) => v.verb).join(', ')}`),
      out('SYS', null, 'Tab completes a verb, Up recalls the last 20, / focuses the line, Esc clears these answers'),
      out('SYS', null, 'there is no shell: a word that is not a verb is refused'),
    ]
    default: return [out('SYS', 'fault', 'unknown verb; try help')]
  }
}

/** A verb that changes something, after the person said yes. The answer says what happened, or FAULT with why. */
export async function runHeavy(verb: string, ctx: CommandContext): Promise<Raw[]> {
  try {
    if (verb === 'restart brain') return [out('SYS', 'live', await ctx.restartBrain())]
    if (verb === 'free gpu') return [out('SYS', 'live', await ctx.freeGpu())]
    if (verb === 'export memory') {
      if (!ctx.exportMemory) return [out('SYS', 'planned', 'export memory is not built: no route writes the memory export yet')]
      return [out('SYS', 'live', await ctx.exportMemory())]
    }
    return [out('SYS', 'fault', 'unknown verb; try help')]
  } catch (e) {
    return [out('SYS', 'fault', (e as Error).message || 'that did not work')]
  }
}

export const lampWord = (s: LampState | null): string => (s ? LAMP_SPECS[s].label : '')
