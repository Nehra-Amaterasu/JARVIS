/**
 * Setup under the v3 look (R18, 27 Nov). The older frame kept Setup behind a sixth tab (Alt+6); under v3 the tab does not exist, so
 * the page was unreachable. This hosts the SAME panes (SetupPage.tsx exports them) in the shell's three trays, and imports their
 * logic: nothing here saves, resets or reads a field.
 *
 *   1 SECTIONS  the eighteen panes as one list (a dot on a pane with unsaved changes)
 *   2 PANE      the save bar (always on top of the pane: it says what it will save, and the Save key is one press away), the server's
 *               answer to the last save in the same sticky block (so it is read where Save was pressed, also on the phone), and the pane
 *   3 UNSAVED   the panes with a draft, each a key that goes to it, the fictional-example line, and how saving works
 *
 * Phone: the first tray is the list; choosing a pane opens the second tray as its sheet (the pane), and the Save bar rides at the top
 * of that sheet, so it is reachable without leaving the pane. The overlays the panes open (Date sheet, Phone, Confirm) are drawn by
 * the OverlayHost of the Well Wisher frame; the frame is not mounted here, so this mounts its own.
 */
import { lazy, Suspense, useContext } from 'react'
import { PrimaryOwner } from '../kit'
import { PeekCtx, Zones } from '../../shell/v3'
import { SECTION_LABEL, type SectionId } from './inputs'
import { SetupExample, SetupIndex, SetupPanes, SetupReport, SetupSaveBar, anchorOf, goToSection, useSetupLifecycle } from './SetupPage'
import '../design/base.css'
import './setup.css'
import './setup-v3.css'

const Overlays = lazy(() => import('../overlays/setupOverlays').then(async () => ({ default: (await import('../frame/OverlayHost')).OverlayHost })))

/** The shell's phone breakpoint (shell-v3.css): below it the second and third tray are sheets. */
const PHONE = '(max-width: 700px)'

/** The list, inside the first tray: a pick on the phone also opens the pane's sheet. On the desktop it must not: an open sheet makes the
 *  tray a modal dialog (role, Tab trap, Esc), which a side-by-side tray is not. */
function Sections({ view, dirty }: { view: string; dirty: SectionId[] }) {
  const peek = useContext(PeekCtx)
  return <SetupIndex view={view} dirty={dirty} onPick={() => { if (window.matchMedia?.(PHONE).matches) peek?.setOpen(2) }} />
}

/** Tray 3: the drafts waiting, each a key that goes to its pane; and the two rules of saving, said once. */
function Unsaved({ dirty }: { dirty: SectionId[] }) {
  return (
    <div className="su3-notes su-main">
      <SetupExample />
      {dirty.length === 0 ? (
        <p className="su-hint" data-su-unsaved="none">Nothing is waiting to be saved.</p>
      ) : (
        <ul className="su3-unsaved" data-su-unsaved="list">
          {dirty.map((d) => (
            <li key={d}><button type="button" className="su-index-btn ww-tap" onClick={() => goToSection(anchorOf(d))}>{SECTION_LABEL[d]}</button></li>
          ))}
        </ul>
      )}
      <p className="su-hint">Nothing here saves by itself. A change waits as a draft until you press Save, and it stays when you move to another pane.</p>
      <p className="su-hint">Closing the window with unsaved changes asks first.</p>
    </div>
  )
}

/** A doorway for a `#setup/<pane>` hash (the shell loads this module through pageLoaders). */
export { showView as showSetupPane } from './view'

export default function SetupV3() {
  const { dirty, view } = useSetupLifecycle()
  const n = dirty.length
  return (
    <PrimaryOwner>
      <div className="ww ww-setup-v3 su3" data-section="wellwisher" data-page="setup" data-view={view}>
        <Zones
          ratio={[1.3, 2.1, 0.75]}
          first={{
            job: 'SECTIONS',
            ruler: false,
            children: <Sections view={view} dirty={dirty} />,
          }}
          second={{
            job: 'PANE',
            peek: { name: 'Pane', lamp: n > 0 ? 'waiting' : undefined, note: n > 0 ? `${n} unsaved` : 'nothing to save' },
            children: (
              <div className="su3-pane">
                {/* the bar and the engine's answer stay together at the top while a long pane scrolls under them */}
                <div className="su3-top">
                  <SetupSaveBar dirty={dirty} />
                  <SetupReport />
                </div>
                <div className="su3-panes su-main">
                  <SetupPanes view={view} />
                </div>
              </div>
            ),
          }}
          third={{
            job: 'UNSAVED',
            peek: { name: 'Unsaved', lamp: n > 0 ? 'waiting' : undefined, note: n > 0 ? `${n} to save` : 'nothing waiting' },
            children: <Unsaved dirty={dirty} />,
          }}
        />
        <Suspense fallback={null}><Overlays /></Suspense>
      </div>
    </PrimaryOwner>
  )
}
