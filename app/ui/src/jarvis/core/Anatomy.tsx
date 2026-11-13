// The Anatomy drawer's body (spec 20.9.1): the five organs as a 5-spoke RingBars and a table. A spoke is the organ's
// last measured latency over its own 7-day median (1.0 = typical), and only where both exist; ROOM, SENSE and MEM
// have no latency the app measures, so their spokes are stubs that say "not measured". No score, no confidence.
import { RingBars } from '../../shared/art'
import { Lamp, sinceText, showsNumber, type LampState } from '../../shared/lamp'
import { STAGE_WORD, spokeRatio, type Organ, type OrganId, type StageId, type StageMedian } from './model'

/** Which pipeline stage times each organ. Organs with none are drawn as stubs, never given a made-up time. */
export const ORGAN_STAGE: Record<OrganId, StageId | null> = { brain: 'think', voice: 'write', room: null, sense: null, mem: null }
/** The ring's full scale: twice the median. A spoke past it is drawn at full length and the table says the ratio. */
export const SPOKE_MAX = 2

export interface AnatomyProps {
  organs: Organ[]
  last: Record<StageId, number | null>
  medians: Record<StageId, StageMedian>
  focus?: OrganId | null
  now: number
  simulated?: boolean
}

export function anatomyRows(organs: Organ[], last: AnatomyProps['last'], medians: AnatomyProps['medians']) {
  return organs.map((o) => {
    const st = ORGAN_STAGE[o.id]
    const ratio = st ? spokeRatio(last[st], medians[st]?.value ?? null) : null
    return { organ: o, stage: st, ratio }
  })
}

export function Anatomy({ organs, last, medians, focus = null, now, simulated = false }: AnatomyProps) {
  const rows = anatomyRows(organs, last, medians)
  const any = rows.some((r) => r.ratio !== null)
  const state: LampState = any ? (simulated ? 'simulated' : 'live') : 'waiting'
  return (
    <div className="jc-anat">
      <div className="jc-anat-ring">
        <RingBars
          bars={rows.map((r) => ({ id: r.organ.id, label: r.organ.name, value: r.ratio }))}
          max={SPOKE_MAX}
          state={state}
          unit="x"
          caption="Last latency over its own 7-day median; 1x is typical"
          reason={any ? undefined : 'no stage has both a last time and a median yet'}
        />
      </div>
      <table className="jc-anat-table">
        <caption className="jc-sr">The five organs: state, source, and last latency against the median</caption>
        <thead>
          <tr><th scope="col">Organ</th><th scope="col">State</th><th scope="col">Since</th><th scope="col">Timed by</th><th scope="col">Last / median</th></tr>
        </thead>
        <tbody>
          {rows.map(({ organ, stage, ratio }) => {
            const med = stage ? medians[stage] : null
            const ls = stage ? last[stage] : null
            const lampState = simulated && organ.reading.state === 'live' ? 'simulated' : organ.reading.state
            // the latency is its own reading: measured on the last turn (LIVE, or SIMULATED in a fixture) or absent
            const latState: LampState = ratio !== null ? (simulated ? 'simulated' : 'live') : 'waiting'
            const timed = ratio !== null && showsNumber(latState)
            return (
              <tr key={organ.id} data-focus={focus === organ.id ? 'true' : undefined}>
                <th scope="row"><span className="jc-tag">[{organ.name.slice(0, 3)}]</span> {organ.name}</th>
                <td><Lamp reading={{ ...organ.reading, state: lampState }} subject={organ.name} now={now} /> <span className="jc-anat-why">{organ.reading.reason}</span></td>
                <td className="jc-anat-mono">{sinceText(organ.reading, now)}</td>
                <td className="jc-anat-mono">{stage ? STAGE_WORD[stage] : 'not timed'}</td>
                <td className="jc-anat-mono">
                  <Lamp reading={{ state: latState, since: null, reason: timed ? 'last turn against its median' : stage ? 'no last time or no median yet' : 'not timed by the app' }} showLabel={false} />{' '}
                  {timed && ls !== null && med?.value ? `${ls.toFixed(1)} s / ${med.value.toFixed(1)} s = ${ratio}x` : stage ? 'no median yet' : 'not measured'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
