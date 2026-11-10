/**
 * How many times each card has rendered, for the render-count test (plan 5.8.4: a class tap re-renders
 * only L3, a counter tap only L4). One increment per render is about 10 ns; the test reads and resets it.
 */
export const renders: Record<string, number> = {}
export const bump = (id: string): void => void (renders[id] = (renders[id] ?? 0) + 1)
export const resetRenders = (): void => {
  for (const k of Object.keys(renders)) delete renders[k]
}
