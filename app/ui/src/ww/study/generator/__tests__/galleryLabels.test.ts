// The X03 gallery entry (gallery/entries/X03.tsx) lists its state labels itself so a JARVIS only build holds no ww/ module;
// ww/study/generator/gallery.tsx holds the states. This pins the two lists together so a state cannot be added to one alone.
import { describe, expect, it } from 'vitest'
import entries from '../../../../gallery/entries/X03'
import { X03_LABELS } from '../gallery'

describe('the X03 gallery entry and its lazy states', () => {
  it('carry the same labels in the same order', () => {
    expect(entries[0].states.map((s) => s.label)).toEqual(X03_LABELS)
  })
})
