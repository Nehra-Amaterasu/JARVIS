// The gym session inside the Body page (25 Nov: "forge should be a part of the body page, it should not open like that"). Tray 1 of
// Day / Body: one key starts it in place, the muscles are chosen, then ONE ROW PER EXERCISE with its three inputs and the cue small,
// then Save. Same data and the same save as the Forge page (useGymSession); the markup and the look are v3's.
import { Sparkles } from 'lucide-react'
import { Button, Chip } from '../../../shared/kit'
import { isFilled, lastLine, type GymSession as Gym } from './useGymSession'

const FIELDS = [['sets', 'Sets'], ['reps', 'Reps'], ['weight', 'Kg']] as const

export function GymSession({ gym, lastSession }: { gym: Gym; lastSession?: string | null }) {
  const { stage, session, drafts, filled } = gym
  if (stage === 'idle') {
    return (
      <div className="by-session" data-stage="idle">
        <Button tone="primary" size="lg" className="dy-primary" onClick={gym.start} data-act="log-session">Log a session</Button>
        <p className="by-session-line">{gym.said ?? 'Choose the muscles you train today, then write down sets, reps and kg for each lift.'}</p>
        {lastSession && <p className="by-session-last"><span className="by-session-lastlabel">Last session</span> {lastSession}</p>}
      </div>
    )
  }
  if (stage === 'pick' || !session) {
    return (
      <div className="by-session" data-stage="pick">
        <h3 className="by-session-head">Which muscles today</h3>
        <p className="by-session-line">The sparkle marks back and shoulders, the groups that build width.</p>
        <div className="by-muscles" role="group" aria-label="Muscles to train">
          {gym.muscles.map((m) => (
            <Chip key={m} selected={gym.selected.has(m)} onClick={() => gym.toggle(m)}>
              {m}{gym.vTaper(m) && <Sparkles size={12} aria-hidden="true" />}
            </Chip>
          ))}
        </div>
        <div className="by-session-keys">
          <Button tone="primary" size="lg" className="dy-primary" disabledReason={gym.selected.size ? undefined : 'Choose a muscle first'} onClick={gym.build} data-act="build-session">
            {gym.selected.size ? `Build the session (${gym.selected.size})` : 'Choose a muscle'}
          </Button>
          <Button onClick={gym.cancel}>Cancel</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="by-session" data-stage="lift">
      <div className="by-session-top">
        <h3 className="by-session-head">{[...gym.selected].join(' · ')}</h3>
        <Button size="sm" onClick={gym.changeMuscles} data-act="change-muscles">Change muscles</Button>
      </div>
      <ol className="by-lifts" aria-label="Exercises of this session">
        {session.map((ex, i) => {
          const d = drafts[ex.id] ?? { sets: '', reps: '', weight: '' }
          const last = gym.getLast(ex.id)
          return (
            <li key={ex.id} className="by-lift" data-filled={isFilled(d) ? 'true' : undefined} data-exercise={ex.id}>
              <div className="by-lift-what">
                <span className="by-lift-name"><span className="by-lift-n">{String(i + 1).padStart(2, '0')}</span>{ex.name}{ex.vTaper && <Sparkles size={12} aria-label="builds width" />}</span>
                <span className="by-lift-cue">{ex.muscle} · {ex.defaultSets}×{ex.defaultReps}{ex.note ? ` · ${ex.note}` : ''}</span>
                <span className="by-lift-last" data-history={last ? 'yes' : 'no'}>{lastLine(last)}</span>
              </div>
              <div className="by-lift-nums">
                {FIELDS.map(([f, label]) => (
                  <label key={f} className="by-num">
                    <span className="by-num-label">{label}</span>
                    <input className="by-num-input" inputMode="decimal" aria-label={`${ex.name}: ${label.toLowerCase()}`} value={d[f]} onChange={(e) => gym.setField(ex.id, f, e.target.value)} />
                  </label>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="by-session-keys">
        <Button tone="primary" size="lg" className="dy-primary" disabledReason={filled ? undefined : 'Fill at least one lift: sets, reps and kg'} onClick={gym.save} data-act="save-session">
          {`Save session (${filled}/${session.length} filled)`}
        </Button>
        <Button onClick={gym.cancel}>Cancel</Button>
      </div>
    </div>
  )
}
