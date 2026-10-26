/** The segmented control on top of the Tree screen: Skills (the bank) plus every life tree the server sends. */
import type { LifeTree } from './lifeTrees'

export const SKILLS = 'skills'

export function TreeSwitcher({ trees, active, onPick }: { trees: LifeTree[]; active: string; onPick: (id: string) => void }) {
  const items = [{ id: SKILLS, name: 'Skills', sub: '' }, ...trees.map((t) => ({ id: t.id, name: t.name, sub: `${t.progress.mastered}/${t.progress.total}` }))]
  return (
    <div className="tree-switch" role="tablist" aria-label="Which tree">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={`ts-item ${active === t.id ? 'on' : ''}`} data-tree={t.id}
          onClick={() => onPick(t.id)} title={trees.find((x) => x.id === t.id)?.about || undefined}>
          {t.name}{t.sub && <span className="ts-sub">{t.sub}</span>}
        </button>))}
    </div>
  )
}
