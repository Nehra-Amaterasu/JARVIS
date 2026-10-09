import { defineConfig } from 'vitest/config'

// Unit tests for the UI's logic (the ported Mission Germoney engine, the storage
// shim). happy-dom provides window/location/sessionStorage, which lib/api reads.
export default defineConfig({
  test: { environment: 'happy-dom', include: ['src/**/*.test.ts'] },
})
