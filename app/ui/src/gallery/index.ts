// The gallery module (wave 5 contract). N02 mounts `default` lazily at the place app.new; later packages add a file under
// gallery/entries and nothing else.
export { default, default as WhatIsNew } from './WhatIsNew'
export { collectEntries, loadProductEntries } from './collect'
export type { GalleryEntry } from './types'
