// The voice setting of Core Talk (spec 20.6.6: one Trim, the voice on its first tab and the spoken words on its second;
// parity ledger O4b, O4d). Registered here so the palette index (`:`) finds it and the audit can prove it has a Trim on
// the view that uses it (SpeechTrim.tsx mounts it). The value comes from the server's own last answer (speech.ts);
// before it has answered it reads "not loaded yet".
import type { SettingDef } from '../../shared/trim/types'
import { SPEED_DEFAULT, speechStore, voiceValueText, wordsValueText } from './speech'

export const voice: SettingDef = {
  id: 'core.voice',
  label: 'JARVIS voice and words',
  section: 'core',
  view: 'talk',
  read: () => `${voiceValueText(speechStore.get())}; ${wordsValueText(speechStore.get())}`,
  reset: () => void speechStore.resetVoice(),
  defaultText: `the server's default voice at ${SPEED_DEFAULT.toFixed(2)}×`,
  isDefault: () => {
    const v = speechStore.get().voice
    return !!v && v.chosen === v.default && Math.abs(v.speed - SPEED_DEFAULT) < 0.001
  },
}

export const settings = [voice]
