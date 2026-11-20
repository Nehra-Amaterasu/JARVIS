import { br, type TreeSrc } from './schema'

// Nodes of this tree are earned by logged sessions with an instructor or a grade certificate, never by self-rating (spec 20.8.5).
// Sleep and nutrition are habits and general knowledge here, not medical advice.
const tree: TreeSrc = {
  id: 'body',
  name: 'Body and self-defence',
  about: 'Strength, movement and safety, earned by sessions with an instructor or a grade certificate.',
  refreshDays: 30,
  branches: [
    br('Strength', 'Bodyweight basics | Loaded movement patterns | A planned block with a coach'),
    br('Mobility', 'A daily routine | Hips and shoulders | A full-range test with a coach'),
    br('Endurance', 'Easy aerobic base | Intervals | A timed distance'),
    br('Posture', 'Sitting and standing | Strength for the back | A checked routine'),
    br('Krav Maga basics', 'Stance and movement | Striking | Escapes from holds'),
    br('Ground safety', 'Getting up safely | Staying protected | Controlled drills with a partner'),
    br('Awareness and de-escalation', 'Reading a place | Words and distance | Leaving a bad situation'),
    br('Falls and breakfalls', 'Rolling basics | Falling backward and sideways | A drilled sequence'),
    br('Recovery', 'Rest days | Stretching after a session | A planned lighter week'),
    br('Sleep routine', 'A steady wake time | A wind-down habit | Four weeks logged'),
    br('Nutrition basics', 'Reading a label | Regular meals and water | A simple weekly plan'),
    br('Grade track', 'Attend regularly | Pass a trainer-led test | A grade certificate'),
    br('Self-defence capstone', 'Pressure-free drills | A trainer-led scenario | A graded demonstration', true),
  ],
}
export default tree
