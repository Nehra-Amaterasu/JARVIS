import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'academic',
  name: 'Academic core',
  about: 'The maths, science and study habits every course leans on.',
  refreshDays: 90,
  branches: [
    br('Calculus', 'Limits and continuity | Derivatives and rates | Integrals and series'),
    br('Linear algebra', 'Vectors and matrices | Systems and rank | Eigenvalues and decompositions'),
    br('Probability', 'Counting and events | Random variables | Limit theorems'),
    br('Statistics', 'Describing data | Estimation and intervals | Tests and regression'),
    br('Discrete maths', 'Sets and logic | Graphs and relations | Proof by induction'),
    br('Mechanics', 'Forces and motion | Energy and momentum | Rotation and oscillation'),
    br('Electromagnetism', 'Fields and potential | Circuits and induction | Maxwell and waves'),
    br('Chemistry basics', 'Atoms and bonding | Reactions and balance | Equilibrium and energy'),
    br('Data structures', 'Arrays and lists | Trees and hashing | Graphs and heaps'),
    br('Algorithms', 'Complexity | Sorting and searching | Dynamic programming and greedy'),
    br('Writing', 'Clear sentences | Structure of an argument | A full report'),
    br('Reading papers', 'Abstract and figures first | Following the method | Summarising in your own words'),
    br('Exam technique', 'Reading the question | Timing a paper | Reviewing mistakes'),
    br('Academic capstone', 'Choose a question | Collect and check sources | A short research note', true),
  ],
}
export default tree
