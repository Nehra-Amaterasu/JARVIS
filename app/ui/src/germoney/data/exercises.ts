/**
 * IRON FORGE â€” exercise library.
 *
 * The user CHOOSES muscle groups; the screen generates a session by pulling
 * exercises here with movement-pattern variety (e.g. Back = vertical pull +
 * horizontal pull + lat-biased pullover). Every group below is covered.
 *
 * User context (baked into defaults/notes): Push/Pull/Legs, chasing
 * a V-taper. Exercises that build the taper (lats + side delts) carry `vTaper`
 * so the UI can flag them.
 */

export type MuscleGroup =
  | 'Chest'
  | 'Back'
  | 'Shoulders'
  | 'Biceps'
  | 'Triceps'
  | 'Legs (Quads)'
  | 'Legs (Hamstrings)'
  | 'Glutes'
  | 'Calves'
  | 'Core'
  | 'Forearms'
  | 'Neck'
  | 'Traps';

/** Movement pattern â€” drives variety when generating a session. */
export type MovementPattern =
  | 'vertical-pull'
  | 'horizontal-pull'
  | 'pullover'
  | 'incline-press'
  | 'flat-press'
  | 'fly'
  | 'overhead-press'
  | 'lateral'
  | 'rear-delt'
  | 'curl'
  | 'extension'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'isolation'
  | 'raise'
  | 'shrug'
  | 'flexion'
  | 'twist'
  | 'plank';

export type Exercise = {
  id: string;
  name: string;
  pattern: MovementPattern;
  defaultSets: number;
  defaultReps: string;
  /** Coaching cue. */
  note?: string;
  /** Flags lat / side-delt work â€” the movements that build the V-taper. */
  vTaper?: boolean;
};

/** Ordered by pattern so session-generation naturally spreads across movements. */
export const EXERCISES: Record<MuscleGroup, Exercise[]> = {
  Chest: [
    { id: 'ch_incline_bb', name: 'Incline Barbell Press', pattern: 'incline-press', defaultSets: 4, defaultReps: '8-10', note: 'Upper chest â€” sets the shelf under the delts.' },
    { id: 'ch_flat_bb', name: 'Flat Bench Press', pattern: 'flat-press', defaultSets: 4, defaultReps: '8-10' },
    { id: 'ch_cable_fly', name: 'Cable / DB Fly', pattern: 'fly', defaultSets: 3, defaultReps: '12-15', note: 'Stretch at the bottom, squeeze across.' },
  ],
  Back: [
    { id: 'bk_pullup', name: 'Pull-Up / Lat Pulldown', pattern: 'vertical-pull', defaultSets: 4, defaultReps: '8-12', note: 'Wide grip, drive elbows down â€” width for the taper.', vTaper: true },
    { id: 'bk_row', name: 'Seated Cable Row', pattern: 'horizontal-pull', defaultSets: 3, defaultReps: '10-12', note: 'Thickness through the mid-back.' },
    { id: 'bk_pullover', name: 'Straight-Arm Pullover', pattern: 'pullover', defaultSets: 3, defaultReps: '12-15', note: 'Isolates the lats â€” flare the wings.', vTaper: true },
  ],
  Shoulders: [
    { id: 'sh_ohp', name: 'Overhead Press', pattern: 'overhead-press', defaultSets: 4, defaultReps: '8-10' },
    { id: 'sh_lateral', name: 'Lateral Raise', pattern: 'lateral', defaultSets: 4, defaultReps: '12-15', note: 'Side delts â€” the caps that widen the frame.', vTaper: true },
    { id: 'sh_rear', name: 'Rear Delt Fly / Face Pull', pattern: 'rear-delt', defaultSets: 3, defaultReps: '15-20', note: 'Keeps the shoulders balanced and healthy.' },
  ],
  Biceps: [
    { id: 'bi_barbell', name: 'Barbell Curl', pattern: 'curl', defaultSets: 3, defaultReps: '8-12' },
    { id: 'bi_incline', name: 'Incline DB Curl', pattern: 'curl', defaultSets: 3, defaultReps: '10-12', note: 'Long-head stretch for the peak.' },
    { id: 'bi_hammer', name: 'Hammer Curl', pattern: 'curl', defaultSets: 3, defaultReps: '12-15', note: 'Hits the brachialis â€” pushes the biceps up.' },
  ],
  Triceps: [
    { id: 'tr_dip', name: 'Dips / Close-Grip Bench', pattern: 'flat-press', defaultSets: 3, defaultReps: '8-12' },
    { id: 'tr_skull', name: 'Skullcrushers', pattern: 'extension', defaultSets: 3, defaultReps: '10-12', note: 'Long head â€” the mass of the arm.' },
    { id: 'tr_pushdown', name: 'Rope Pushdown', pattern: 'extension', defaultSets: 3, defaultReps: '12-15' },
  ],
  'Legs (Quads)': [
    { id: 'lq_squat', name: 'Back / Front Squat', pattern: 'squat', defaultSets: 4, defaultReps: '6-10' },
    { id: 'lq_press', name: 'Leg Press', pattern: 'squat', defaultSets: 3, defaultReps: '10-12' },
    { id: 'lq_extension', name: 'Leg Extension', pattern: 'extension', defaultSets: 3, defaultReps: '12-15', note: 'Finish the quads â€” squeeze at lockout.' },
  ],
  'Legs (Hamstrings)': [
    { id: 'lh_rdl', name: 'Romanian Deadlift', pattern: 'hinge', defaultSets: 4, defaultReps: '8-10', note: 'Hips back, feel the stretch.' },
    { id: 'lh_curl', name: 'Lying / Seated Leg Curl', pattern: 'curl', defaultSets: 4, defaultReps: '10-12' },
    { id: 'lh_goodmorning', name: 'Good Morning', pattern: 'hinge', defaultSets: 3, defaultReps: '10-12' },
  ],
  Glutes: [
    { id: 'gl_hipthrust', name: 'Barbell Hip Thrust', pattern: 'hinge', defaultSets: 4, defaultReps: '8-12', note: 'Full lockout, squeeze hard.' },
    { id: 'gl_lunge', name: 'Walking Lunge', pattern: 'lunge', defaultSets: 3, defaultReps: '10-12' },
    { id: 'gl_kickback', name: 'Cable Glute Kickback', pattern: 'isolation', defaultSets: 3, defaultReps: '12-15' },
  ],
  Calves: [
    { id: 'ca_standing', name: 'Standing Calf Raise', pattern: 'raise', defaultSets: 4, defaultReps: '12-15', note: 'Gastrocnemius â€” pause at the top.' },
    { id: 'ca_seated', name: 'Seated Calf Raise', pattern: 'raise', defaultSets: 4, defaultReps: '15-20', note: 'Bent knee hits the soleus.' },
  ],
  Core: [
    { id: 'co_legraise', name: 'Hanging Leg Raise', pattern: 'flexion', defaultSets: 3, defaultReps: '10-15', note: 'Control the negative, no swinging.' },
    { id: 'co_plank', name: 'Plank', pattern: 'plank', defaultSets: 3, defaultReps: '45-60s', note: 'Brace hard â€” anti-extension.' },
    { id: 'co_crunch', name: 'Cable Crunch', pattern: 'flexion', defaultSets: 3, defaultReps: '15-20', note: 'Load the rectus â€” round the spine down.' },
  ],
  Forearms: [
    { id: 'fo_wristcurl', name: 'Wrist Curl', pattern: 'curl', defaultSets: 3, defaultReps: '15-20', note: 'Flexors â€” full range off the bench.' },
    { id: 'fo_reversecurl', name: 'Reverse Curl', pattern: 'curl', defaultSets: 3, defaultReps: '12-15', note: 'Extensors + brachioradialis.' },
    { id: 'fo_reversewrist', name: 'Reverse Wrist Curl', pattern: 'extension', defaultSets: 3, defaultReps: '15-20' },
  ],
  Neck: [
    { id: 'ne_flexion', name: 'Neck Flexion (plate/harness)', pattern: 'flexion', defaultSets: 3, defaultReps: '15-20', note: 'Slow and light â€” chin to chest.' },
    { id: 'ne_extension', name: 'Neck Extension (harness)', pattern: 'extension', defaultSets: 3, defaultReps: '15-20', note: 'Controlled range, never jerk.' },
  ],
  Traps: [
    { id: 'tp_shrug', name: 'Barbell / DB Shrug', pattern: 'shrug', defaultSets: 4, defaultReps: '12-15', note: 'Straight up, hold the squeeze.' },
    { id: 'tp_farmer', name: "Farmer's Carry", pattern: 'shrug', defaultSets: 3, defaultReps: '30-40m' },
    { id: 'tp_facepull', name: 'Face Pull (high)', pattern: 'rear-delt', defaultSets: 3, defaultReps: '15-20', note: 'Hits lower/mid traps and rear delts.' },
  ],
};

/** Stable, ordered list of every selectable muscle group. */
export const MUSCLE_GROUPS = Object.keys(EXERCISES) as MuscleGroup[];

/**
 * Build a session from the chosen muscles. Takes 2-3 movements per muscle,
 * already ordered for pattern variety in EXERCISES. Returns a flat list tagged
 * with the muscle each exercise trains.
 */
export type SessionExercise = Exercise & { muscle: MuscleGroup };

export function generateSession(
  muscles: MuscleGroup[],
  perMuscle = 3,
): SessionExercise[] {
  const session: SessionExercise[] = [];
  for (const muscle of muscles) {
    const picks = EXERCISES[muscle].slice(0, perMuscle);
    for (const ex of picks) {
      session.push({ ...ex, muscle });
    }
  }
  return session;
}
