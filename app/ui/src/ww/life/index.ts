// Chunk 8, the Life workspace. MissionRoot mounts LifeWorkspace; the left column (chunk 6) can use CounterTiles
// and counterTiles() so the college tile is read from the class list.
export { LifeWorkspace } from './LifeWorkspace'
export type { LifeView } from './LifeWorkspace'
export { CounterTiles } from './CounterTiles'
export { counterTiles, wentToCollege, classProgress, marginView, MIN_SAMPLE } from './derive'
export type { AttendanceAnswer, Counter, CollegeState, Tile } from './derive'
