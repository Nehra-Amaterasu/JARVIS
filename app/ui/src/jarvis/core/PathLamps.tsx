// The slim strip under the orb (v3 look): four small lamps, Hear, Write, Think, Say, that light in order as a spoken turn
// moves through them. The lit one is the stage the core says is running NOW (model.ts runningStage via ribbonStages); the
// others show their own lamp (a disc for a value measured in this run, a half disc for none yet). No number is printed here:
// the seconds, their medians and the lamp words are in the VOICE PATH tray, one tray to the right.
import { LAMP_SPECS, LampGlyph } from '../../shared/lamp'
import { STAGE_MEANS, type RibbonStage } from './model'
import { PATH_WORD } from './orb'

export function PathLamps({ stages }: { stages: RibbonStage[] }) {
  return (
    <ol className="jc3-path" aria-label="Where the turn is: hear, write, think, say">
      {stages.map((s) => {
        const spec = LAMP_SPECS[s.state]
        const name = `${PATH_WORD[s.id]}: ${s.running ? 'running now' : spec.label.toLowerCase()}${s.reason && !s.running ? `, ${s.reason}` : ''}. Measures ${STAGE_MEANS[s.id]}`
        return (
          <li key={s.id} className="jc3-path-step" data-stage={s.id} data-state={s.state} data-on={s.running ? 'true' : undefined} title={name} aria-label={name}
            style={{ ['--lamp-ink' as string]: `var(${spec.token})` }}>
            <LampGlyph state={s.state} className="jc3-path-lamp" />
            <span className="jc3-path-word" aria-hidden="true">{PATH_WORD[s.id]}</span>
          </li>
        )
      })}
    </ol>
  )
}
