import { br, type TreeSrc } from './schema'

const tree: TreeSrc = {
  id: 'engineering',
  name: 'Engineering and making',
  about: 'Building things that run: code, circuits and the habits that keep them working.',
  refreshDays: 90,
  branches: [
    br('Programming fundamentals', 'Variables and control flow | Functions and data | A program of 200 lines'),
    br('Web', 'Pages and styling | Scripts and requests | A small working site'),
    br('Systems and OS', 'Processes and files | Memory and scheduling | Reading a system log'),
    br('Networks', 'Addresses and packets | Protocols and ports | Tracing a request'),
    br('Databases', 'Tables and keys | Queries and joins | Schema design'),
    br('Electronics', 'Ohm and Kirchhoff | Transistors and op-amps | A powered, tested circuit'),
    br('Embedded', 'Pins and timers | Serial and interrupts | A board that runs on its own'),
    br('Signal processing', 'Sampling | Filters and the FFT | A measured spectrum'),
    br('Machine learning basics', 'Data and splits | Fitting a model | Checking what it learned'),
    br('Version control', 'Commits and history | Branches and merges | A reviewed change'),
    br('Testing', 'A first unit test | Fixtures and edge cases | A suite that guards a change'),
    br('Hardware debugging', 'A multimeter | A logic probe or scope | Isolating a fault'),
  ],
}
export default tree
