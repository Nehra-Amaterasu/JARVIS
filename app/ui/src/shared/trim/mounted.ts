/**
 * Which Trims are on screen. A Trim registers its setting id while mounted so a test (and the dev audit) can prove
 * that every registered setting has a home. A count per id, because two Trims for one setting (a section view and
 * its phone twin) are legal and the first unmount must not hide the second.
 */
const counts = new Map<string, number>()

export function trimMounted(id: string): () => void {
  counts.set(id, (counts.get(id) ?? 0) + 1)
  return () => {
    const n = (counts.get(id) ?? 1) - 1
    if (n <= 0) counts.delete(id)
    else counts.set(id, n)
  }
}

export const mountedTrimIds = (): string[] => [...counts.keys()].sort()
