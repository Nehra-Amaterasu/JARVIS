/* Unprompted remarks: the switch for JARVIS speaking up on his own (core/proactive.py).
   The same switch as "Jarvis, quiet mode" / "you can talk again". */
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import { usePoll } from '../lib/format'
import { useStore } from '../lib/store'

interface Proactive {
  enabled: boolean
  muted: boolean
  quiet_start: string
  quiet_end: string
  min_gap_min: number
}

const load = () => api<Proactive>('/api/settings/proactive')

export function RemarksCard() {
  const [view] = usePoll(load, 15000)
  const [p, setP] = useState<Proactive | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => { if (view) setP(view) }, [view])
  const save = async (change: Partial<Proactive>) => {
    try {
      setP(await post<Proactive>('/api/settings/proactive', change))
    } catch (e) {
      toast((e as Error).message || 'That did not save.', 'fault')
    }
  }
  const on = !!p && p.enabled && !p.muted
  return (
    <section className="card cx-card">
      <div className="card-head">
        <span className="card-title"><span className="track">B4</span>Remarks</span>
        <button className={`switch ${on ? 'on' : ''}`} aria-pressed={on} aria-label="Unprompted remarks"
          disabled={!p} onClick={() => p && save(on ? { muted: true } : { enabled: true, muted: false })} />
      </div>
      <p className="muted cx-small">
        {!p ? 'Reading the switch…'
          : on ? `He may speak up on his own about what his staff notices: at most once every ${p.min_gap_min} min, never ${p.quiet_start}–${p.quiet_end}, never while you talk or something plays.`
            : 'He stays quiet unless you talk to him. Say "you can talk again" or flip the switch.'}
      </p>
    </section>
  )
}
