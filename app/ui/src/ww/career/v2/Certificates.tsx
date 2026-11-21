// Career / Certificates (spec 20.8.6, package T02): a shelf of engraved plates, six to a row. A plate for a certificate that is held is
// solid; one not yet held is a hollow, dashed plate (PLANNED) of the same size with a "Do next step" key. A fee is a stamped cell:
// the bank's price is quoted as unconfirmed text until the student types it from the certificate's own page. The classic page's
// logic (the open list, Mark earned with a link, the earned line) is the same store call; nothing is rewritten.
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePlan, type CertRow } from '../../../germoney/game/plan'
import { useGame } from '../../../germoney/game/store'
import { useStore } from '../../../lib/store'
import { Button, Drawer, Field, IconButton } from '../../../shared/kit'
import { inr, paginate } from '../model'
import { LampWord } from '../../left/LampWord'
import { cellRead, stampText, useCareerLocal, type Cell } from './store'
import { ConfirmForm, Frame, Plate, Stamped, useWidth, PHONE_BELOW } from './ui'
import { lookV3Enabled } from '../../../shell/v3'

const PER_PAGE = 18
const PER_PAGE_PHONE = 8
export const certKey = (id: string): string => `cert:${id}`

export interface CertificatesProps {
  certs: CertRow[] | null
  today: string
  cells: Record<string, Cell>
  local: Record<string, { scan: string; expiry: string }>
  onConfirm: (id: string, value: string, on: string) => void
  onClear: (id: string) => void
  onEarn: (id: string, url: string) => void
  onLocal: (id: string, scan: string, expiry: string) => void
  width?: number
  initialOpen?: string | null
  simulated?: boolean
}

function CertPlate({ c, onOpen, onNext, selected }: { c: CertRow; onOpen: () => void; onNext: () => void; selected: boolean }) {
  const held = !!c.earned
  return (
    <li className="t2-cplate" data-held={held ? 'true' : 'false'} data-cert={c.id} data-selected={selected ? 'true' : undefined}>
      {/* a tile, not a label: a long name may take three lines, so it is a role=button block and not a <button> whose text must stay short */}
      <div
        role="button" tabIndex={0} className="t2-cplate-main" aria-label={`${c.name}, ${held ? `held, ${stampText(c.earned!.earned)}` : 'planned'}. Enter opens it`}
        onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      >
        <b>{c.name}</b>
        <span>{c.issuer || 'issuer not named'}</span>
        <small>{held ? `Held ${stampText(c.earned!.earned)}. ${c.node_ids.length} node${c.node_ids.length === 1 ? '' : 's'}` : `PLANNED. ${c.node_ids.length} node${c.node_ids.length === 1 ? '' : 's'}`}</small>
      </div>
      {!held && <Button size="md" className="t2-cplate-key" onClick={onNext}>Do next step</Button>}
    </li>
  )
}

export function CertificatesView({ certs, today, cells, local, onConfirm, onClear, onEarn, onLocal, width, initialOpen = null, simulated }: CertificatesProps) {
  const [rootRef, w] = useWidth<HTMLDivElement>(width)
  const phone = w < PHONE_BELOW
  const loaded = certs !== null
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(initialOpen)
  const ordered = useMemo(() => {
    const all = certs ?? []
    return [...all.filter((c) => c.earned), ...all.filter((c) => !c.earned)]
  }, [certs])
  const p = paginate(ordered, page, phone ? PER_PAGE_PHONE : PER_PAGE)
  const held = (certs ?? []).filter((c) => c.earned).length
  const opened = open ? ordered.find((c) => c.id === open) ?? null : null
  const next = (c: CertRow) => { if (c.url) window.open(c.url, '_blank', 'noopener'); else setOpen(c.id) }
  const pager = p.pages > 1 ? (
    <nav className="t2-pager" aria-label="Certificates, pages">
      <IconButton label="Previous certificates" size="md" aria-disabled={p.page === 0} onClick={() => p.page > 0 && setPage(p.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></IconButton>
      <span role="status" aria-live="polite">{p.from} to {p.to} of {p.total}</span>
      <IconButton label="Next certificates" size="md" aria-disabled={p.page >= p.pages - 1} onClick={() => p.page < p.pages - 1 && setPage(p.page + 1)}><ChevronRight size={18} aria-hidden="true" /></IconButton>
    </nav>
  ) : null
  const v3 = lookV3Enabled()
  const shelf = (
    <Plate id="shelf" label="SHELF" state={loaded ? 'live' : 'waiting'} reason={loaded ? 'held plates first, then planned' : 'bank not read yet'} className="t2-shelfplate" corner={pager}>
      {!loaded ? <p className="t2-quiet">WAITING: the certificate bank has not answered.</p> : ordered.length === 0 ? <p className="t2-quiet">No certificate in the bank.</p> : (
        <ul className="t2-shelf" aria-label="Certificates">
          {p.rows.map((c) => <CertPlate key={c.id} c={c} selected={open === c.id} onOpen={() => setOpen(c.id)} onNext={() => next(c)} />)}
        </ul>
      )}
    </Plate>
  )
  const bodyProps = { today, cells, local, onConfirm, onClear, onEarn, onLocal }
  const pick = <p className="t2-quiet">Open a certificate from the shelf to see its fee and the steps.</p>
  return (
    <Frame
      simulated={simulated} view="certs" ruler="CERTIFICATES" title="Certificates" form={phone ? 'phone' : 'desk'} rootRef={rootRef} state={loaded ? 'live' : 'waiting'}
      sub={loaded ? <>{held} held, {ordered.length - held} planned. A price is the bank's until you confirm it on the page.</> : 'Reading the certificate bank. Nothing is shown until it answers.'}
      v3={{ ratio: [1.7, 1.15, 1], trays: [
        { job: 'SHELF', node: shelf, peek: { name: 'One certificate', lamp: opened ? 'waiting' : 'planned', note: opened ? 'fee unconfirmed until you check it' : 'none opened' } },
        { job: 'ONE', node: opened ? <><h3 className="t2-v3-name">{opened.name}</h3><CertBody c={opened} part="one" {...bodyProps} /></> : pick, peek: { name: 'One certificate' } },
        { job: 'STEPS', node: opened ? <CertBody c={opened} part="steps" {...bodyProps} /> : pick, peek: { name: 'Steps' } },
      ] }}
      extra={v3 ? null : <CertDrawer c={opened} onClose={() => setOpen(null)} {...bodyProps} />}
    >
      {shelf}
    </Frame>
  )
}

type CertBodyProps = Omit<CertificatesProps, 'certs' | 'width' | 'initialOpen' | 'simulated'> & { c: CertRow }

/** The detail of one certificate. `part` splits it for the v3 trays: the fee and its stamp (ONE), the scan, expiry and earning (STEPS). */
function CertBody({ c, today, cells, local, onConfirm, onClear, onEarn, onLocal, part = 'all' }: CertBodyProps & { part?: 'all' | 'one' | 'steps' }) {
  const [url, setUrl] = useState('')
  const l = local[c.id] ?? { scan: '', expiry: '' }
  const read = cellRead(cells, certKey(c.id))
  // the bank's own figures (credibility, hours) are not measured: they are drawn under "the list says" with a WAITING lamp
  const meta = [c.linkedin_worthy ? 'LinkedIn-worthy' : '', c.free_option ? `free option: ${c.free_option}` : ''].filter(Boolean).join('. ')
  const listSays = [c.credibility ? `credibility ${c.credibility}` : '', c.time_hours ? `about ${c.time_hours} h` : ''].filter(Boolean).join(', ')
  return (
    <div className="t2-form" data-cert-detail={c.id}>
      {part !== 'steps' && (
        <>
          <p className="t2-quiet">{c.issuer}{meta ? `. ${meta}` : ''}. Fit: {c.budget_fit}.</p>
          {listSays && <p className="t2-quiet"><LampWord state="waiting" /> The list says: {listSays}. Unconfirmed.</p>}
          {c.url && <p className="t2-quiet"><a href={c.url} target="_blank" rel="noreferrer">Its own page</a></p>}
          <ConfirmForm
            key={c.id + read.state} label="Fee" read={read} today={today} kind="number"
            bank={c.cost_inr ? `${inr(c.cost_inr)}, as reported in the bank` : 'free, as reported in the bank'}
            hint="In rupees, as the certificate's page says."
            onSave={(v, on) => onConfirm(c.id, v, on)} onClear={() => onClear(c.id)}
          />
        </>
      )}
      {part !== 'one' && (
        <>
          <Field label="Scan path (a file on this computer)" value={l.scan} onChange={(e) => onLocal(c.id, e.target.value, l.expiry)} />
          <Field label="Expiry" kind="date" value={l.expiry} onChange={(e) => onLocal(c.id, l.scan, e.target.value)} hint="Leave empty if it does not expire." />
          <p className="t2-quiet">Counts toward {c.node_ids.length} skill node{c.node_ids.length === 1 ? '' : 's'}. Marking it earned adds an evidence record on the Tree.</p>
          {c.earned ? (
            <Stamped label="Earned on" read={{ state: 'live', value: stampText(c.earned.earned), on: c.earned.earned }} />
          ) : (
            <>
              <Field label="Link to the certificate" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button size="lg" disabledReason={url.trim() ? undefined : 'needs the link'} onClick={() => { onEarn(c.id, url.trim()); setUrl('') }}>Mark earned</Button>
            </>
          )}
        </>
      )}
    </div>
  )
}

function CertDrawer({ c, onClose, ...rest }: Omit<CertBodyProps, 'c'> & { c: CertRow | null; onClose: () => void }) {
  return (
    <Drawer open={!!c} onClose={onClose} title={c ? c.name : 'Certificate'} className="t2-drawer">
      {c && <CertBody c={c} {...rest} />}
    </Drawer>
  )
}

export default function Certificates() {
  const data = usePlan((s) => s.certs)
  const loadRoad = usePlan((s) => s.loadRoad)
  const earn = usePlan((s) => s.earnCert)
  const today = useGame((s) => s.today)
  const cells = useCareerLocal((s) => s.cells)
  const local = useCareerLocal((s) => s.certs)
  const confirmCell = useCareerLocal((s) => s.confirmCell)
  const clearCell = useCareerLocal((s) => s.clearCell)
  const setCert = useCareerLocal((s) => s.setCert)
  const toast = useStore((s) => s.toast)
  // the classic page asked for the road on mount; the certificate bank comes with it
  useEffect(() => { if (usePlan.getState().certs === null) void loadRoad() }, [loadRoad])
  return (
    <CertificatesView
      certs={data?.certs ?? null} today={today} cells={cells} local={local}
      onConfirm={(id, v, on) => confirmCell(certKey(id), v, on)} onClear={(id) => clearCell(certKey(id))}
      onEarn={(id, url) => void earn(id, url).then((r) => toast(r.say, r.ok ? 'live' : 'fault'))}
      onLocal={setCert}
    />
  )
}
