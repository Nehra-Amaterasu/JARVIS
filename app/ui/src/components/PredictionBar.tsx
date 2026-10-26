/**
 * The live prediction, with a way to say whether it is right, and the fan.
 *
 *   Predicting: <place>   the belief's top zone, worded by the backend's status word
 *                         (lib/teachTrain predictionWording): never "you're at" before
 *                         the model has passed a held-out day
 *   ✓                     right: the last 10 s become a span labelled with that place,
 *                         source "confirmed"
 *   No, I'm at…           wrong: pick the real place; the last 10 s become a span with
 *                         source "correction". Both are training data.
 *   Fan                   what the engine reports (detected beats the relay's word), and
 *                         on / off buttons as a manual override through the relay board
 */
import { Check, Fan } from 'lucide-react'
import { useState } from 'react'
import { readBelief, topZone, TELL_P } from '../lib/belief'
import { CORRECT_SECONDS, correct, fanView, predictionWording, setFan, type StatusWord, type ZoneLite } from '../lib/teachTrain'

type ToastFn = (m: string, tone?: 'live' | 'sim' | 'fault' | 'info') => void

export function PredictionBar({ belief, fan, live, zones, status, toast }: {
  belief: unknown; fan: unknown; live: boolean; zones: ZoneLite[]; status: StatusWord; toast: ToastFn
}) {
  const [busy, setBusy] = useState(false)
  const b = readBelief(belief)
  const top = b?.state === 'empty' ? null : topZone(b)
  const shown = b?.state === 'empty'
    ? { id: 'out_of_room', name: 'nobody in the room' }
    : top && top.p >= TELL_P ? { id: top.id, name: top.name } : null
  const f = fanView(fan)

  const send = async (zone: string, confirmed: boolean) => {
    setBusy(true)
    try {
      const r = await correct(zone, confirmed)
      toast(confirmed ? `Kept: the last ${Math.round(r.seconds)} s are ${r.name}` : `Corrected: the last ${Math.round(r.seconds)} s are ${r.name}`, 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }
  const flip = async (on: boolean) => {
    try {
      const r = await setFan(on)
      if (!r.ok) toast(r.error ?? 'The relay board did not switch the fan', 'fault')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  return (
    <div className="pred-bar glass-thin" role="group" aria-label="Live prediction">
      <span className={`pred-text ${status === 'answering' ? 'answering' : ''}`}>
        {predictionWording(status, shown?.name ?? (b ? "can't tell" : null))}
      </span>
      <button className="btn sm ghost" aria-label="Right" title={`Right: label the last ${CORRECT_SECONDS} s as this place`}
        disabled={!live || !shown || busy} onClick={() => shown && void send(shown.id, true)}><Check size={13} /></button>
      <select className="pred-pick" aria-label="No, I'm at…" disabled={!live || busy || !zones.length} value=""
        onChange={(e) => { const z = e.target.value; if (z) void send(z, false) }}>
        <option value="">No, I'm at…</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
      </select>
      <span className="pred-fan mono" title="What the engine reports; the buttons switch the fan through the relay board">
        <Fan size={12} />{f.text}
      </span>
      <span className="seg pred-fan-seg">
        <button className={f.on === true ? 'on' : ''} aria-label="Fan on" onClick={() => void flip(true)}>on</button>
        <button className={f.on === false ? 'on' : ''} aria-label="Fan off" onClick={() => void flip(false)}>off</button>
      </span>
    </div>
  )
}
