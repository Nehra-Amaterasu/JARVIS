import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'health',
  name: 'Health basics',
  about: 'General knowledge to learn and practise. Nothing here diagnoses or treats anything.',
  refreshDays: 60,
  branches: [
    br('First-aid course', 'Calling for help | Basic care steps | A certificate from a course'),
    br('Hydration', 'Why water matters | A drinking routine | Two weeks logged'),
    br('Sleep routines', 'A steady bedtime | A wind-down habit | Four weeks logged'),
    br('Medication reminders', 'Setting a reminder | Logging that it was seen | A log kept for a month'),
    br('Work pacing and breaks', 'A work and rest rhythm | Taking real breaks | A week kept to the rhythm'),
    br('Eye and posture breaks', 'The 20-20-20 habit | Stretching at the desk | A routine kept for two weeks'),
    br('Safe lifting', 'Planning a lift | Lifting with a neutral back | Teaching it to someone'),
    br('Kitchen hygiene', 'Washing and storing | Cooking safely | A tidy kitchen routine'),
    br('Reading a nutrition label', 'Serving sizes | Comparing two products | A shopping list built from labels'),
  ],
}
export default tree
