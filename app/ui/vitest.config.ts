import { defineConfig } from 'vitest/config'

// Unit tests for the UI's logic (the ported Mission Germoney engine, the storage
// shim). happy-dom provides window/location/sessionStorage, which lib/api reads.
export default defineConfig({
  // testTimeout: several tests walk the whole source tree (the import seams, the clay layer, the lamp contract). Alone they
  // take under a second; on 20 Nov, with three builders running tests on the same laptop, six of them passed the 5 s default
  // and failed as timeouts while every assertion held (356 of 356 with time allowed). 30 s only changes when a hang is
  // called a failure, not what any test checks.
  //
  // env.VITE_LOOK_DEFAULT = 'off': the production default is the v3 look (shell/look.ts), but about 3,900 of these tests were
  // written against the older frame. Setting it here keeps them as they are; src/__tests__/shell/v3/look.test.ts stubs it back
  // to prove the on-by-default case.
  test: { environment: 'happy-dom', include: ['src/**/*.test.{ts,tsx}'], testTimeout: 30_000, env: { VITE_LOOK_DEFAULT: 'off' } },
})
