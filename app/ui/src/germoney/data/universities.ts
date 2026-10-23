/**
 * Target universities (kept from the old static syllabus, knowledge-base.ts, when
 * the skill tree moved to the bank). Shown on the Road. Verify each against the
 * programme page before applying: requirements change.
 */
export interface University {
  name: string;
  program: string;
  language: string;
  /** German-scale GPA expectation, verbatim from the doc */
  gpa: string;
  ects: string;
  prerequisites: string;
  portal: string;
  portalUrl: string;
  intake: string;
}

export const TARGET_UNIVERSITIES: University[] = [
  {
    name: 'TU Munich (TUM)',
    program: 'MSc Electrical & Computer Engineering',
    language: 'English / German (bilingual tracks)',
    gpa: '> 8.5/10 (German 1.5–2.0)',
    ects: '120 ECTS Master; strong Bachelor in Math, Physics & core EE',
    prerequisites: 'Aptitude Assessment (VPD via uni-assist); curriculum matching',
    portal: 'TUMonline',
    portalUrl: 'https://campus.tum.de',
    intake: 'Winter & Summer',
  },
  {
    name: 'RWTH Aachen',
    program: 'MSc Electrical Engineering',
    language: 'English',
    gpa: '> 8.0/10',
    ects: 'Strict math & fundamental engineering credits matching RWTH BSc',
    prerequisites: 'GRE heavily recommended; conditional admission possible',
    portal: 'RWTHonline',
    portalUrl: 'https://online.rwth-aachen.de',
    intake: 'Winter & Summer',
  },
  {
    name: 'TU Dresden',
    program: 'MSc Nanoelectronic Systems',
    language: 'English',
    gpa: '> 7.5/10',
    ects: 'Microelectronics, semiconductor physics & EE background',
    prerequisites: 'Nanotech/VLSI focus — ideal for TSMC Dresden placement',
    portal: 'selma',
    portalUrl: 'https://selma.tu-dresden.de',
    intake: 'Winter (mainly)',
  },
  {
    name: 'KIT Karlsruhe',
    program: 'MSc Electrical Engineering & Information Technology',
    language: 'German / English (some majors need German C1)',
    gpa: '> 8.0/10',
    ects: 'Strict module matching',
    prerequisites: 'Strong programming & signal processing background favored',
    portal: 'KIT Application Portal',
    portalUrl: 'https://bewerbung.studium.kit.edu',
    intake: 'Winter & Summer',
  },
  {
    name: 'TU Darmstadt',
    program: 'MSc Electrical Engineering & Information Technology',
    language: 'English',
    gpa: '> 8.0/10',
    ects: 'Detailed module-manual comparison required',
    prerequisites: 'Entrance exam or GRE if curriculum does not match',
    portal: 'TUCaN',
    portalUrl: 'https://www.tucan.tu-darmstadt.de',
    intake: 'Winter & Summer',
  },
  {
    name: 'TU Berlin',
    program: 'MSc Electrical Engineering',
    language: 'German (primarily) / some English tracks',
    gpa: '> 7.5/10',
    ects: 'Strict math & physics requirement',
    prerequisites: 'German proficiency often required for full flexibility',
    portal: 'tuPORT',
    portalUrl: 'https://tuport.tu-berlin.de',
    intake: 'Winter & Summer',
  },
  {
    name: 'Universität Stuttgart',
    program: 'MSc Electrical Engineering',
    language: 'English',
    gpa: '> 7.5/10',
    ects: 'Good coverage of fundamental ECE modules',
    prerequisites: 'Proximity to Bosch & automotive electronics hub',
    portal: 'C@MPUS',
    portalUrl: 'https://campus.uni-stuttgart.de',
    intake: 'Winter',
  },
];
