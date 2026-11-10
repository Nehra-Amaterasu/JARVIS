// Career > Certificates: CA4 (plan 3.3, 4.7). The bank has about 30 open certificates; they are paged,
// never scrolled, and every one is reachable (the contract test counts N of N).
import { useMemo, useState } from 'react'
import { usePlan, type CertRow } from '../../germoney/game/plan'
import { useStore } from '../../lib/store'
import { Button, Card, Chip, type ChipTone } from '../kit'
import { Paged } from './Paged'
import { inr } from './model'

const FIT_TONE: Record<CertRow['budget_fit'], ChipTone> = { free: 'live', 'in budget': 'live', stretch: 'sim', 'over budget': 'fault' }

function CertLine({ c }: { c: CertRow }) {
  const earn = usePlan((s) => s.earnCert)
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState('')
  const meta = [c.issuer, c.credibility ? `credibility ${c.credibility}` : '', c.linkedin_worthy ? 'LinkedIn-worthy' : '', c.time_hours ? `about ${c.time_hours} h` : ''].filter(Boolean).join(' . ')
  return (
    <div className="cr-cert" data-cert={c.id}>
      <span className="cr-cert-main">
        <span className="cr-clip cr-cert-name" title={c.name}>
          {c.url ? (
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.name}
            </a>
          ) : (
            c.name
          )}
        </span>
        <span className="cr-clip cr-sub" title={meta}>
          {meta}
        </span>
      </span>
      <span className="cr-cost">{c.cost_inr ? inr(c.cost_inr) : 'free'}</span>
      <Chip tone={FIT_TONE[c.budget_fit]}>{c.budget_fit}</Chip>
      <input className="ww-input cr-link" aria-label={`Certificate link for ${c.name}`} placeholder="certificate link" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button
        size="sm"
        disabledReason={url.trim() ? undefined : 'needs the link'}
        onClick={() =>
          void earn(c.id, url.trim()).then((r) => {
            toast(r.say, r.ok ? 'live' : 'fault')
            if (r.ok) setUrl('')
          })
        }
      >
        Mark earned
      </Button>
    </div>
  )
}

export function CertsView() {
  const data = usePlan((s) => s.certs)
  const { earned, open } = useMemo(() => {
    const certs = data?.certs ?? []
    return { earned: certs.filter((c) => c.earned), open: certs.filter((c) => !c.earned) }
  }, [data])
  const b = data?.budget
  return (
    <div className="cr-view cr-view-one" data-view="certs">
      <Card
        data-card="CA4"
        title="Certificates"
        kicker={b ? `budget ${inr(b.cert_inr_month)} a month . up to ${inr(b.cert_stretch_inr)} for a very credible one` : undefined}
        loading={!data}
        className="cr-fill"
      >
        <p className="cr-line" data-earned="">
          <b>Earned:</b> {earned.length ? earned.map((c) => c.name).join(', ') : 'none yet'}
        </p>
        <Paged items={open} rowKey={(c) => c.id} row={(c) => <CertLine c={c} />} label="certificates" fallback={8} empty="No open certificate in the bank." />
        <p className="cr-foot">In budget fits one month; stretch is over the month but credible enough (4 of 5 or more) to save up for. Prices are as reported in the bank: check before paying.</p>
      </Card>
    </div>
  )
}
