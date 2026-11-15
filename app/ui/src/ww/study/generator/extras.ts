// The members the generator screens need that StudyPort (ww/study/ports.ts, frozen, owned by Y01) does not have yet. They are named
// here once, as one optional object, so the first adapter that supplies them (AD08, or the integrator) wires `save`, `infer` and
// `swap` without a screen change; until then each control that needs one is disabled WITH its reason, and nothing pretends it worked.
//
//   save   PUT  /api/mission/pyq/blueprints/{exam}      (R-20)   an unbalanced blueprint is saved so it can be edited on
//   infer  POST /api/mission/pyq/blueprints/infer       (R-21)   a RULE proposal, not saved
//   swap   a seeded draw that replaces one slot (no route yet)
import type { PortReply } from '../ports'
import type { GenBlueprint, Issue, PaperView } from './model'

export interface GeneratorExtras {
  save?: (bp: GenBlueprint) => Promise<PortReply<{ blueprint: GenBlueprint; issues: Issue[] }>>
  infer?: () => Promise<PortReply<{ blueprint: GenBlueprint; issues: Issue[]; trace: string[] }>>
  swap?: (paper: PaperView, section: string, n: number) => Promise<PortReply<PaperView>>
}

export const NO_EXTRAS: GeneratorExtras = {}
