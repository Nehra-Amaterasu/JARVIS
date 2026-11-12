// The three grammars of spec 20.4 (package G02): sigil, ASCII and terminal. Import this folder, not its files.
export { sigilSvg, sigilModel, sealModel, sigilStats, modelToSvg, MAX_SEGMENTS, MAX_BYTES, SIZE_BUDGET, type SigilOptions, type SigilSize, type SigilFold, type SigilModel } from './sigil/generate'
export { fnv1a32, mulberry32, seedHex } from './sigil/hash'
export { PRIMITIVES, PRIMITIVE_NAMES, type PrimitiveName } from './sigil/primitives'
export { Sigil, SigilFrame, GlyphRule, Seal, type SigilProps, type SigilFrameProps, type GlyphRuleProps, type SealProps } from './sigil/Sigil'
export { RAMPS, sparkline, rampGlyph, freezeText, scatterText, bayerField, atmosphereProblems, atmosphereBudget, SPARK_BLOCKS, SPARK_GAP, type RampName } from './ascii/ramps'
export { AsciiPlate, AsciiHeat, AsciiBar, AsciiPortrait, barTrack, heatLevel, portraitText, type AsciiPlateProps, type AsciiHeatProps, type AsciiBarProps, type AsciiPortraitProps } from './ascii/Ascii'
export { TermWell, TermLine, BootSequence, ScanFrame, TAG_WORDS, tagText, promptParts, typeMs, type TermWellProps, type TermLineProps, type BootSequenceProps, type ScanFrameProps } from './term/Term'
export { grammarReport, GRAMMARS, type Grammar, type GrammarUse } from './lint'
