/**
 * Achievements: each marks a behaviour that matters, never a number for its own sake.
 * "Wall Breaker" exists because the profile says the streak dies around day 14.
 */
export interface Stats {
  contracts: number
  crits: number
  maxCombo: number
  bestStreak: number
  germanHours: number
  focusMinutes: number
  longestFocus: number
  bosses: number
  ambushes: number
  trialsPassed: number
  drillCards: number
  level: number
  rewardsBought: number
  phoenix: boolean
  earlyFloors: number
  operationsWon: number
  momentum: number
}

export interface AchievementDef { id: string; name: string; desc: string; test: (s: Stats) => boolean; marks: number }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-blood', name: 'First Blood', desc: 'Complete your first contract.', test: (s) => s.contracts >= 1, marks: 25 },
  { id: 'crit', name: 'Critical Hit', desc: 'Land a critical contract.', test: (s) => s.crits >= 1, marks: 25 },
  { id: 'chain', name: 'Chain Reaction', desc: 'Four contracts in one day.', test: (s) => s.maxCombo >= 4, marks: 50 },
  { id: 'iron-week', name: 'Iron Week', desc: 'A 7-day streak.', test: (s) => s.bestStreak >= 7, marks: 75 },
  { id: 'wall', name: 'Wall Breaker', desc: 'A 15-day streak — past the 2-week wall that ended every plan before.', test: (s) => s.bestStreak >= 15, marks: 150 },
  { id: 'month', name: 'Month of Steel', desc: 'A 30-day streak.', test: (s) => s.bestStreak >= 30, marks: 250 },
  { id: 'century', name: 'Centurion', desc: 'A 100-day streak.', test: (s) => s.bestStreak >= 100, marks: 1000 },
  { id: 'deutsch10', name: 'Erste Schritte', desc: '10 hours of German.', test: (s) => s.germanHours >= 10, marks: 75 },
  { id: 'deutsch50', name: 'Sprachkrieger', desc: '50 hours of German.', test: (s) => s.germanHours >= 50, marks: 250 },
  { id: 'deep', name: 'Deep Diver', desc: 'A 90-minute Crucible, held.', test: (s) => s.longestFocus >= 90, marks: 75 },
  { id: 'hundred', name: 'Hundred Hours', desc: '100 hours in the Crucible.', test: (s) => s.focusMinutes >= 6000, marks: 400 },
  { id: 'slayer', name: 'Boss Slayer', desc: 'Defeat your first boss.', test: (s) => s.bosses >= 1, marks: 100 },
  { id: 'ambush', name: 'Ambush', desc: 'Kill a boss before its HP ran low.', test: (s) => s.ambushes >= 1, marks: 100 },
  { id: 'certified', name: 'Certified', desc: 'Pass your first Trial.', test: (s) => s.trialsPassed >= 1, marks: 150 },
  { id: 'drill500', name: 'Drill Sergeant', desc: '500 cards reviewed.', test: (s) => s.drillCards >= 500, marks: 150 },
  { id: 'level10', name: 'Double Digits', desc: 'Reach level 10.', test: (s) => s.level >= 10, marks: 100 },
  { id: 'phoenix', name: 'Phoenix', desc: 'Lose a streak, then secure three days straight.', test: (s) => s.phoenix, marks: 100 },
  { id: 'early', name: 'Early Bird', desc: 'Secure the floor before 10:00, five times.', test: (s) => s.earlyFloors >= 5, marks: 75 },
  { id: 'operator', name: 'Operator', desc: 'Win three weekly operations.', test: (s) => s.operationsWon >= 3, marks: 150 },
  { id: 'momentum', name: 'Momentum', desc: 'Four operation weeks in a row.', test: (s) => s.momentum >= 4, marks: 200 },
  { id: 'earned', name: 'Earned It', desc: 'Buy your first real-life reward with Marks. Rest you earned is not guilt.', test: (s) => s.rewardsBought >= 1, marks: 25 },
]
