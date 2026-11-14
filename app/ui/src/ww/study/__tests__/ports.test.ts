// The Study port: sixteen members, a null adapter that only ever answers WAITING (or PLANNED), and a composition by rank.
import { describe, expect, it } from 'vitest'
import { STUDY_MEMBERS, STUDY_PORT, collectAdapters, composePort, type PortReply } from '../ports'
import { nullStudyPort } from '../adapters/null.register'
import { waiting } from '../adapters/types'

describe('StudyPort', () => {
  it('has the sixteen members of the contract table', () => {
    expect(STUDY_MEMBERS).toEqual(['papers', 'questions', 'ingest', 'decide', 'crop', 'blueprints', 'generate', 'patterns', 'practiseNext', 'check', 'readiness', 'tonight', 'queue', 'harvest', 'intake', 'classroom'])
    expect(Object.keys(nullStudyPort).sort()).toEqual([...STUDY_MEMBERS].sort())
  })
  it('the null adapter answers WAITING with a reason and no data, except Classroom which is PLANNED', async () => {
    const calls: Record<string, () => Promise<PortReply<unknown>>> = {
      papers: () => nullStudyPort.papers(), questions: () => nullStudyPort.questions(), ingest: () => nullStudyPort.ingest({ route: 'drop' }),
      decide: () => nullStudyPort.decide({ kind: 'accept', qid: 'x' }), crop: () => nullStudyPort.crop({ qid: 'x', bbox: [0, 0, 1, 1] }),
      blueprints: () => nullStudyPort.blueprints(), generate: () => nullStudyPort.generate({ blueprintId: 'b', seed: 1 }), patterns: () => nullStudyPort.patterns(),
      practiseNext: () => nullStudyPort.practiseNext(), check: () => nullStudyPort.check({ qid: 'x', answer: '1' }), readiness: () => nullStudyPort.readiness(),
      tonight: () => nullStudyPort.tonight(), queue: () => nullStudyPort.queue(), harvest: () => nullStudyPort.harvest(), intake: () => nullStudyPort.intake(), classroom: () => nullStudyPort.classroom(),
    }
    expect(Object.keys(calls)).toHaveLength(16)
    for (const [name, call] of Object.entries(calls)) {
      const r = await call()
      expect(r.state, name).toBe(name === 'classroom' ? 'planned' : 'waiting')
      expect(r.data, name).toBeNull()
      expect(r.reason.length, name).toBeGreaterThan(3)
    }
  })
  it('the collected port is the null adapter until a real one registers', async () => {
    expect((await STUDY_PORT.papers()).state).toBe('waiting')
  })
  it('a higher rank replaces only the members it supplies', async () => {
    const real = { id: 'real', rank: 10, port: { papers: async () => ({ state: 'live' as const, reason: '', since: 1, data: [] }) } }
    const port = composePort([{ id: 'null', rank: 0, port: nullStudyPort }, real])
    expect((await port.papers()).state).toBe('live')
    expect((await port.questions()).state).toBe('waiting')
  })
  it('a member nobody supplies answers WAITING, never throws', async () => {
    const port = composePort([])
    expect((await port.crop({ qid: 'x', bbox: [0, 0, 1, 1] })).state).toBe('waiting')
  })
  it('collects default and named registrations and skips files without one', () => {
    const regs = collectAdapters({ './a.register.ts': { default: { id: 'a', rank: 1, port: {} } }, './b.register.ts': { registration: { id: 'b', rank: 2, port: {} } }, './c.register.ts': { nothing: true } })
    expect(regs.map((r) => r.id)).toEqual(['a', 'b'])
    expect(waiting('x').data).toBeNull()
  })
})
