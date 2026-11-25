/**
 * The top plate (design-language-v3.md 3.3): 64 px, always visible, never replaced. Left to right: the location three
 * levels deep (project over "Section / View"), the view switch, ONE lamp pill, More, the window keys. It replaces the title
 * bar and the view strip of the current shell.
 */
import { useCallback, useRef, useState } from 'react'
import { APP_PLACES, PRODUCT_LABEL, VIEW_LABEL, isAppPlace, sectionById, type Place } from '../ids'
import type { MoreAction } from './contract'
import { WinGlyph } from './Glyphs'
import { LampPill } from './LampPill'
import type { LampRow } from './lamps'
import { Popover, usePopoverChoose } from './Popover'
import { subProjectOfSection } from './subprojects'
import { ViewChip } from './ViewChip'

export type PlateMenu = 'pill' | 'more' | 'views' | null

export interface TopPlateProps {
  place: Place
  rows: readonly LampRow[]
  /** Everything under "RARELY NEEDED": the view's own actions, then the shell's. */
  more: readonly MoreAction[]
  glass: boolean
  onGlass: (on: boolean) => void
  onGoSection: (section: string) => void
  onSetView: (view: string) => void
  onShortcuts: () => void
  /** Window keys show only inside the desktop window. */
  windowKeys: boolean
}

export function projectNameOf(place: Place): string {
  if (isAppPlace(place)) return PRODUCT_LABEL[place.product]
  return subProjectOfSection(place.section)?.name ?? PRODUCT_LABEL[place.product]
}

export function TopPlate({ place, rows, more, glass, onGlass, onGoSection, onSetView, onShortcuts, windowKeys }: TopPlateProps) {
  const [menu, setMenu] = useState<PlateMenu>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const app = isAppPlace(place)
  const section = sectionById(place.section)
  const sectionLabel = app ? (APP_PLACES[place.view] ?? place.view) : (section?.label ?? place.section)
  const views = section?.views ?? []
  const viewLabel = VIEW_LABEL[place.view] ?? place.view
  const setOpen = (m: Exclude<PlateMenu, null>) => (open: boolean) => setMenu(open ? m : (cur) => (cur === m ? null : cur))
  const close = useCallback(() => setMenu(null), [])
  const lampOpen = setOpen('pill')
  const pickView = (v: string) => onSetView(v)
  return (
    <header className="s3-top pywebview-drag-region" aria-label="Place and state">
      <div className="s3-loc">
        <span className="s3-loc-p">{projectNameOf(place)}</span>
        <h1 className="s3-loc-s" aria-label={app ? sectionLabel : `${sectionLabel}, ${viewLabel}`}>
          {sectionLabel}
          {!app && views.length > 0 && <em aria-hidden="true"> / {viewLabel}</em>}
        </h1>
      </div>
      {views.length > 1 && (
        <div className="s3-seg" role="group" aria-label={`${sectionLabel} views`}>
          {views.map((v) => (
            <button key={v} id={`s3-view-${v}`} type="button" data-view={v} aria-current={v === place.view ? 'page' : undefined} onClick={() => pickView(v)}>
              {VIEW_LABEL[v] ?? v}
            </button>
          ))}
        </div>
      )}
      {views.length > 1 && (
        <div className="s3-chiprow">
          <ViewChip sectionLabel={sectionLabel} views={views} view={place.view} open={menu === 'views'} onOpenChange={setOpen('views')} onSelect={pickView} />
        </div>
      )}
      <div className="s3-spacer" />
      <LampPill rows={rows} open={menu === 'pill'} onOpenChange={lampOpen} onGoSection={onGoSection} />
      <Popover open={menu === 'more'} onClose={close} triggerRef={moreBtn} label="More" className="s3-morewrap"
        trigger={
          <button ref={moreBtn} type="button" className="s3-key s3-iconkey" aria-haspopup="dialog" aria-expanded={menu === 'more'}
            aria-label={more.length ? `More: ${more.length} rarely needed ${more.length === 1 ? 'action' : 'actions'}` : 'More: appearance and keys'} data-tip={more.length ? `${more.length} more ${more.length === 1 ? 'action' : 'actions'}` : 'Appearance and keys'}
            onClick={() => setMenu(menu === 'more' ? null : 'more')}>
            {WinGlyph.dots}
          </button>
        }>
        <p className="s3-cap">APPEARANCE</p>
        <button type="button" className="s3-switch" role="switch" aria-checked={glass} onClick={() => onGlass(!glass)}>
          <span>Frosted glass</span>
          <em>{glass ? 'ON' : 'OFF'}</em>
          <span className="s3-track" aria-hidden="true" />
        </button>
        <p className="s3-cap">KEYS</p>
        <div className="s3-keys">
          <p><kbd>Alt</kbd> <kbd>{'↑'}</kbd> <kbd>{'↓'}</kbd> sections</p>
          <p><kbd>Alt</kbd> <kbd>{'←'}</kbd> <kbd>{'→'}</kbd> views</p>
        </div>
        <MoreRows more={more} onShortcuts={onShortcuts} />
      </Popover>
      {windowKeys && (
        <div className="s3-wc" role="group" aria-label="Window">
          <button type="button" className="s3-key s3-iconkey s3-flat" aria-label="Minimise" onClick={() => window.pywebview?.api.minimize()}>{WinGlyph.min}</button>
          <button type="button" className="s3-key s3-iconkey s3-flat" aria-label="Maximise" onClick={() => void window.pywebview?.api.toggle_maximize()}>{WinGlyph.max}</button>
          <button type="button" className="s3-key s3-iconkey s3-flat" aria-label="Close" onClick={() => window.pywebview?.api.close()}>{WinGlyph.close}</button>
        </div>
      )}
    </header>
  )
}

function MoreRows({ more, onShortcuts }: { more: readonly MoreAction[]; onShortcuts: () => void }) {
  const choose = usePopoverChoose()
  return (
    <>
      <button type="button" className="s3-popitem" onClick={() => choose(onShortcuts)}>All shortcuts</button>
      {more.length > 0 && <p className="s3-cap">RARELY NEEDED {'·'} {more.length}</p>}
      {more.map((a) => (
        <button key={a.id} type="button" className="s3-popitem" data-more={a.id} onClick={() => choose(a.onSelect)}>{a.label}</button>
      ))}
    </>
  )
}
