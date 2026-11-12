/**
 * Well Wisher theme id to clay theme id (overhaul spec 6.1 and 6.2.3): `paper` becomes `clay-light`,
 * `ash` becomes `clay-dark`, `indigo` stays an optional variant. This is mapping only: nothing
 * reads it yet and `ww/frame/theme.ts` still writes the old ids, so the app is unchanged. The shell
 * (B05) and the Well Wisher section map (B11) switch `applyTheme` over to it behind the flags,
 * and B13 deletes the old theme files.
 *
 * `indigo` has no clay file (spec 6.2.3: it must be rewritten on the layer-2 names and pass the
 * same contrast table, or be dropped), so it maps to itself and clay.css does not style it.
 */
import type { ThemeId } from '../../frame/theme'

export type ClayThemeId = 'clay-light' | 'clay-dark' | 'indigo'

export const WW_THEME_TO_CLAY: Record<ThemeId, ClayThemeId> = {
  paper: 'clay-light',
  ash: 'clay-dark',
  indigo: 'indigo',
}

/** The first-run chrome theme per product (spec 6.1, F6); once the student picks one it applies to both. */
export const FIRST_RUN_CLAY_THEME = { jarvis: 'clay-dark', ww: 'clay-light' } as const satisfies Record<'jarvis' | 'ww', ClayThemeId>

export const clayThemeFor = (theme: ThemeId): ClayThemeId => WW_THEME_TO_CLAY[theme]
