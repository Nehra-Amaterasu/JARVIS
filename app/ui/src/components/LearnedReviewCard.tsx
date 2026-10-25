/**
 * "Learned lately": what JARVIS kept from recent chats with Aman, one Keep / Wrong
 * each. Wrong takes effect at once (chat_memory reads it as rejected); Keep just
 * takes it off the list. Amber, because a memory he distilled is an inference
 * until Aman says otherwise.
 */
import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, post } from '../lib/api'
import { useNow, usePoll } from '../lib/format'
import { afterVerdict, ago, kindLabel, verdictSay, type LearnedQueue, type Verdict } from '../lib/learned'
import { useStore } from '../lib/store'

export function LearnedReviewCard() {
  const [data, loading, reload] = usePoll(() => api<LearnedQueue>('/api/memory/learned?n=6'), 60000)
  const [q, setQ] = useState<LearnedQueue | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  const now = useNow(30000) / 1000
  useEffect(() => { if (data) setQ(data) }, [data])

  const judge = async (id: string, verdict: Verdict) => {
    if (busy) return
    setBusy(id)
    try {
      await post(`/api/memory/learned/${encodeURIComponent(id)}`, { verdict })
      setQ((cur) => (cur ? afterVerdict(cur, id, verdict) : cur))
      toast(verdictSay(verdict), verdict === 'keep' ? 'live' : 'info')
      if ((q?.items.length ?? 0) <= 1) reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card learned">
      <div className="card-head">
        <span className="card-title"><span className="track">L</span>Learned lately</span>
        <span className="mono muted">{q ? `${q.pending} to check · ${q.kept} kept · ${q.wrong} wrong` : '…'}</span>
      </div>
      {!q && <div className={`empty ${loading ? '' : 'fault'}`}>{loading ? 'Loading…' : 'Learned memory isn’t answering. Is the app server up?'}</div>}
      {q && q.items.length === 0 && (
        <div className="empty">Nothing new to check. What JARVIS learns from your chats shows up here.</div>
      )}
      {q?.items.map((m) => (
        <div key={m.id} className="fact learned-row fade-in">
          <div style={{ minWidth: 0 }}>
            <div style={{ userSelect: 'text' }}>{m.text}</div>
            <div className="src">
              <span className="pill sim" style={{ height: 18, marginRight: 8 }}>{kindLabel(m.kind)}</span>
              {ago(m.first_seen, now)} · {Math.round(m.confidence * 100)}%
              {m.support > 1 ? ` · said ${m.support} times` : ''}
            </div>
          </div>
          <div className="belief-btns" style={{ flexShrink: 0 }}>
            <button className="btn live sm" disabled={busy !== null} onClick={() => void judge(m.id, 'keep')}
              aria-label={`Keep: ${m.text}`}><Check size={14} />Keep</button>
            <button className="btn danger sm" disabled={busy !== null} onClick={() => void judge(m.id, 'wrong')}
              aria-label={`Wrong: ${m.text}`}><X size={14} />Wrong</button>
          </div>
        </div>
      ))}
    </section>
  )
}
