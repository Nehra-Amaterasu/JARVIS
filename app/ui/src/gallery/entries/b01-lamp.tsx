// The lamp package (B01): the one state vocabulary. LIVE, WAITING, SIMULATED, PLANNED and FAULT each have a word, a shape and
// a tone, so greyscale and forced colours still tell them apart.
import * as lamp from '../../shared/lamp'
import type { GalleryEntryX } from '../types'
import { NOW, STATE_REASON, States, read } from '../fixtures'

const merged = 'lamp package, 12 Nov'

const entries: GalleryEntryX[] = [
  {
    id: 'lamp/Lamp',
    title: 'Lamp',
    group: 'lamp',
    merged,
    note: 'Five states, one shape each. A number is shown only beside LIVE or SIMULATED.',
    states: [
      { label: 'five states, size 12 with word', node: <States>{(s) => <lamp.Lamp reading={read(s, STATE_REASON[s])} now={NOW} />}</States> },
      { label: 'size 16, no word, with subject', node: <States>{(s) => <lamp.Lamp reading={read(s, STATE_REASON[s])} size={16} showLabel={false} subject="Voice" now={NOW} />}</States> },
    ],
  },
  {
    id: 'lamp/LampGlyph',
    title: 'LampGlyph',
    group: 'lamp',
    merged,
    note: 'The bare shape, for places where the word would not fit.',
    states: [{ label: 'five bare glyphs', node: <States>{(s) => <span style={{ fontSize: 32, color: 'var(--ink-1)' }}><lamp.LampGlyph state={s} /></span>}</States> }],
  },
  {
    id: 'lamp/Reading',
    title: 'Reading',
    group: 'lamp',
    merged,
    note: 'A label, a value and a lamp. WAITING, PLANNED and FAULT print no number.',
    states: [{ label: 'live, simulated, waiting, planned, fault', node: <States>{(s) => <lamp.Reading label={`Level ${s}`} value={12.5} unit="dB" reading={read(s, STATE_REASON[s])} now={NOW} />}</States> }],
  },
  {
    id: 'lamp/Annunciators',
    title: 'Annunciators',
    group: 'lamp',
    merged,
    note: 'The row of lamps on the title bar, one per subsystem.',
    states: [
      { label: 'regular', node: <lamp.Annunciators items={lamp.JARVIS_ANNUNCIATORS} readings={{ [lamp.JARVIS_ANNUNCIATORS[0].id]: read('live'), [lamp.JARVIS_ANNUNCIATORS[1].id]: read('fault', 'relay did not answer') }} now={NOW} /> },
      { label: 'compact', node: <lamp.Annunciators items={lamp.WW_ANNUNCIATORS} readings={{}} compact now={NOW} /> },
    ],
  },
]
export default entries
