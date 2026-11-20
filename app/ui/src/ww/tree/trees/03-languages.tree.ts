import { br, type TreeSrc } from './schema'

// Spec 20.8.5 lists eleven names under "Languages (10)": German in four levels, English academic and speaking, Hindi writing,
// listening, pronunciation, reading, vocabulary upkeep. Reading and vocabulary upkeep are one branch here so the tree holds ten.
const tree: TreeSrc = {
  id: 'languages',
  name: 'Languages',
  about: 'German from A1 to B2, academic English, and the everyday skills around them.',
  refreshDays: 60,
  branches: [
    br('German A1', 'Greetings and numbers | Present tense and questions | A short self-introduction'),
    br('German A2', 'Past tense | Everyday errands | A simple message and a phone call'),
    br('German B1', 'Subordinate clauses | Opinions and plans | A two-minute talk'),
    br('German B2', 'Passive and subjunctive | Reading articles | A formal letter and a discussion'),
    br('English academic', 'Academic vocabulary | Paragraph and citation | A reviewed essay'),
    br('English speaking', 'Clear pronunciation | A short talk | A question-and-answer round'),
    br('Hindi writing', 'Script and spelling | Short paragraphs | A letter or an essay'),
    br('Listening', 'Slow audio | Natural speed | A lecture with notes'),
    br('Pronunciation', 'Sounds and stress | Rhythm and linking | A recorded passage'),
    br('Reading and vocabulary upkeep', 'A daily page | Spaced review of words | A graded text, read through'),
  ],
}
export default tree
