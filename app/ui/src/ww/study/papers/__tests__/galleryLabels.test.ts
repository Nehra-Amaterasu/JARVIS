// The Y01 gallery entry (gallery/entries/Y01.tsx) lists its state labels itself so a JARVIS only build holds no ww/ module;
// ww/study/papers/gallery.tsx holds the states. This pins the two lists together so a state cannot be added to one alone.
import { describe, expect, it } from 'vitest'
import entries from '../../../../gallery/entries/Y01'
import { Y01_LABELS } from '../gallery'

describe('the Y01 gallery entry and its lazy states', () => {
  it('carry the same labels in the same order', () => {
    expect(entries[0].states.map((s) => s.label)).toEqual(Y01_LABELS)
  })
})
