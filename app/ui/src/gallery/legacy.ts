// The Well Wisher stylesheet for the legacy controls. The shared kit still draws Button, Chip, Field and the rest with `.ww-*`
// classes that only the Well Wisher stylesheet defines, and the import-graph test (__tests__/shared/imports.test.ts, seam S2)
// lets only App.tsx and pageLoaders.ts name a Well Wisher module. So the gallery does not import it: the host registers a
// loader once (`setLegacyStyleLoader(() => import('./ww/kit/kit.css'))` in pageLoaders.ts) and the gallery calls it when a
// legacy entry is opened. With no loader the specimen says so instead of drawing unstyled controls without a word.
import { useEffect, useState } from 'react'

export type LegacyStyles = 'ready' | 'loading' | 'missing'

let loader: (() => Promise<unknown>) | null = null
let loaded: Promise<unknown> | null = null

export function setLegacyStyleLoader(l: () => Promise<unknown>): void {
  loader = l
}

/** 'ready' when no legacy entry is open or the sheet is in; 'loading' while it loads; 'missing' with no loader or a failed load. */
export function useLegacyStyles(needed: boolean): LegacyStyles {
  const [state, setState] = useState<LegacyStyles>('ready')
  useEffect(() => {
    if (!needed) { setState('ready'); return }
    if (!loader) {
      // the bench page imports the stylesheet itself and sets this marker, so it never reports 'missing'
      setState(document.documentElement.hasAttribute('data-legacy-styles') ? 'ready' : 'missing')
      return
    }
    let live = true
    setState('loading')
    loaded ??= loader()
    loaded.then(() => { if (live) setState('ready') }, () => { loaded = null; if (live) setState('missing') })
    return () => { live = false }
  }, [needed])
  return state
}
