// Trim and the settings registry (A.L02, spec 20.6.6). Import this folder, not its files.
export { Trim, type TrimProps } from './Trim'
export { SettingsIndex, groupSettings, EMPTY_INDEX_LINE, type SettingsIndexProps, type SettingGroup } from './SettingsIndex'
export { SETTINGS, ALIASES, collectSettings, resolveSetting, danglingAliases, auditTrims, searchSettings, type CollectedSettings, type TrimAudit } from './registry'
export { valueText, type SettingDef } from './types'
export { mountedTrimIds, trimMounted } from './mounted'
export { placePopover, POP_MAX_W, POP_MAX_H, type PopPlace } from './layout'
