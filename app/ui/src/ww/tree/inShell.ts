/** True when the new shell hosts the page. Read once per mount (useState(inShell)), the way the frame and the Today column do. */
export const inShell = (): boolean => typeof document !== 'undefined' && document.querySelector('[data-shell="v2"]') !== null
