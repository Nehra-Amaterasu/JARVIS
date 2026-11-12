import type { ArtSources } from './resolve'

/**
 * Private-track pictures, staged by `tools/art/build_art.py --stage-private` into the git-ignored
 * private-local/ folder. This module is reached only through the inline `import.meta.env.VITE_ART_TRACK ===
 * 'private'` test in index.ts, so a customer build folds that branch away and never bundles the glob.
 * tools/art/check_no_private_in_dist.py is the second lock: it fails any dist holding one of these files.
 */
export const sources: ArtSources = {
  urls: import.meta.glob('./private-local/*.{png,svg,webp}', { query: '?url', import: 'default' }) as ArtSources['urls'],
  texts: import.meta.glob('./private-local/*.txt', { query: '?raw', import: 'default' }) as ArtSources['texts'],
}
