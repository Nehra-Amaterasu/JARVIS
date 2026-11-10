/**
 * Which Setup section is on screen. Setup shows ONE section at a time (the owner's no-scroll rule: a page of
 * eighteen sections is a scroll; eighteen views is not). The store is module-level so a switch to Study and back
 * returns to the same section, and so a doorway elsewhere (the left column's phone pointer) can call showView.
 */
import { create } from 'zustand'

interface ViewState { view: string; focusTick: number }
export const useView = create<ViewState>(() => ({ view: 'rotation', focusTick: 0 }))

/** Show a section without moving focus (a doorway from another page). */
export function showView(anchor: string): void {
  useView.setState({ view: anchor })
}
/** Show a section and ask the page to move focus to it (the index). */
export function focusView(anchor: string): void {
  useView.setState((s) => ({ view: anchor, focusTick: s.focusTick + 1 }))
}
