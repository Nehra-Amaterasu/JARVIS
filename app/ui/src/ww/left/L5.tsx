/**
 * L5: the Phone pointer (plan 4.1). A link row, not a card, and never the fill. Until a phone is paired it
 * reads "Not paired. Set up >" and opens the Phone overlay (O2, a stub until chunk 12); once one is paired
 * it is a quiet "Phone: paired" line with no arrow. If the pairing list could not be read it says that and
 * keeps the door open, because the way in is the same either way.
 */
import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { Section } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { bump } from './renders'
import { useLeft } from './store'

export const L5Row = memo(function L5Row() {
  bump('L5')
  const paired = useLeft((s) => s.paired)
  return (
    <Section id="L5" hint="Pairing pointer for the phone" className="ww-left-sec">
      {paired !== null && paired > 0 ? (
        <p className="ww-phone-line" data-paired="true">Phone: paired</p>
      ) : (
        <button type="button" className="ww-phone-line ww-linkbtn ww-tap" data-paired="false" onClick={() => openOverlay('phone')}>
          {paired === null ? 'Phone: not read. Set up' : 'Not paired. Set up'}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
    </Section>
  )
})
