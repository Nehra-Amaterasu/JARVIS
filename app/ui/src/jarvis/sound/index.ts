// Core, Sound (A.S01): the section's public pieces. The live view is the default export of SoundView.tsx, which
// shell/views/core-sound.view.ts loads lazily.
export { SoundView, SoundLive, type SoundViewProps, type SoundDrawerId } from './SoundView'
export { NowPlate, type NowPlateProps } from './NowPlate'
export { Ring } from './Ring'
export { LibraryCard, LibraryBody } from './Library'
export { WordsCard, WordsBody } from './Words'
export { LIVE_SOUND, type SoundPort } from './port'
export { nowView, receiptView, litMarks, wordRows } from './model'
