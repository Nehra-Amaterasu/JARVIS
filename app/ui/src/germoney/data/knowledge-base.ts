/**
 * KNOWLEDGE BASE — the real content behind the Knowledge Engine screen.
 *
 * Source of truth: docs/03_SKILL_TREE.md (the full A–H skill tree),
 * docs/02_CAREER_VERTICALS.md (8 verticals), docs/01_GERMANY_ROADMAP.md.
 * This module is data-only; screens render it. Do not hardcode content in the
 * screen — add it here so the docs and the app stay in sync.
 *
 * Accent assignment (per design-tokens Palette):
 *   digital / silicon logic ....... accentInfo    (Branch A, D)
 *   HDL / programming / EDA tools .. accentPrimary (Branch B, C, E)
 *   analog & mixed-signal ......... accentWarning (Branch F)
 *   career / German / soft skills . accentPurple  (Branch G)
 *   experimental / future compute . accentInfo    (Branch H)
 */

import { Palette } from '../platform';

export type ResourceTier = 'free' | 'paid';

export interface Resource {
  label: string;
  url: string;
  tier: ResourceTier;
}

export interface Skill {
  /** Doc code, e.g. "A.1" */
  id: string;
  name: string;
  /** 1–2 line "why it matters" pulled from the doc */
  why: string;
  /** Raw prerequisite tokens from the doc, e.g. ["A.5", "E.2"] or ["High School Math"] */
  prerequisites: string[];
  resources: Resource[];
  certification?: string;
  timeToProficiency: string;
  cost: string;
}

export interface SkillBranch {
  id: string;
  name: string;
  /** Short tagline shown under the branch name */
  tagline: string;
  accentColor: string;
  skills: Skill[];
}

// Reusable canonical resource URLs (real links cited or implied by the docs).
const bookSearch = (title: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(title + ' book')}`;

// ---------------------------------------------------------------------------
// BRANCH A — Digital Design Fundamentals (accentInfo)
// ---------------------------------------------------------------------------
const branchA: SkillBranch = {
  id: 'A',
  name: 'BRANCH A — DIGITAL DESIGN FUNDAMENTALS',
  tagline: 'The foundational language of all digital hardware',
  accentColor: Palette.accentInfo,
  skills: [
    {
      id: 'A.1',
      name: 'Number Systems (Binary, Hex, Octal, BCD, Gray Code)',
      why: 'Foundational language of all digital hardware — essential for representing data and addresses.',
      prerequisites: ['High School Math'],
      resources: [
        { label: 'Neso Academy — Digital Electronics (YouTube)', url: 'https://www.nesoacademy.org', tier: 'free' },
        { label: '"Digital Design" by M. Morris Mano', url: bookSearch('Digital Design Morris Mano'), tier: 'paid' },
        { label: 'IEEE 754 floating-point standard', url: 'https://ieeexplore.ieee.org/document/8766229', tier: 'paid' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free (YouTube); textbook optional',
    },
    {
      id: 'A.2',
      name: 'Boolean Algebra & Logic Gates',
      why: 'The mathematical foundation for designing and optimizing digital logic circuits.',
      prerequisites: ['A.1'],
      resources: [
        { label: 'All About Circuits (free online)', url: 'https://www.allaboutcircuits.com', tier: 'free' },
        { label: 'Coursera — Digital Systems (audit free)', url: 'https://www.coursera.org', tier: 'free' },
        { label: 'MIT 6.004 Computation Structures', url: 'https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'A.3',
      name: 'K-Maps & Quine-McCluskey',
      why: 'Essential techniques for minimizing boolean expressions to save hardware area.',
      prerequisites: ['A.2'],
      resources: [
        { label: 'Neso Academy — K-Map tutorials', url: 'https://www.nesoacademy.org', tier: 'free' },
        { label: '"Fundamentals of Logic Design" by C. H. Roth', url: bookSearch('Fundamentals of Logic Design Charles Roth'), tier: 'paid' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'A.4',
      name: 'Combinational Circuits (MUX, Adders, Comparators)',
      why: 'The building blocks of datapath elements in processors and ASICs.',
      prerequisites: ['A.3'],
      resources: [
        { label: "Ben Eater — 8-bit Computer series", url: 'https://eater.net/8bit', tier: 'free' },
        { label: 'NPTEL — Digital Circuits', url: 'https://nptel.ac.in/courses/108105132', tier: 'free' },
        { label: '"CMOS VLSI Design" by Weste (datapath)', url: bookSearch('CMOS VLSI Design Weste Harris'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'A.5',
      name: 'Sequential Circuits (Latches, Flip-Flops)',
      why: 'Enables circuits to have memory and state — the basis of all synchronous designs.',
      prerequisites: ['A.4'],
      resources: [
        { label: 'Neso Academy — Sequential circuits', url: 'https://www.nesoacademy.org', tier: 'free' },
        { label: 'edX — Digital Design courses', url: 'https://www.edx.org', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'A.6',
      name: 'Counters (Sync, Async, Ring, Johnson)',
      why: 'Used for timing, sequencing, and addressing memory in digital systems.',
      prerequisites: ['A.5'],
      resources: [
        { label: 'Electronics Tutorials (free web)', url: 'https://www.electronics-tutorials.ws', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'A.7',
      name: 'Shift Registers (SISO, SIPO, PISO, Universal)',
      why: 'Critical for serial communication protocols (SPI, I2C) and data manipulation.',
      prerequisites: ['A.5'],
      resources: [
        { label: 'All About Circuits', url: 'https://www.allaboutcircuits.com', tier: 'free' },
        { label: '"FPGA Prototyping by Verilog Examples" — Pong P. Chu', url: bookSearch('FPGA Prototyping by Verilog Examples Pong Chu'), tier: 'paid' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'A.8',
      name: 'Finite State Machines (Moore, Mealy)',
      why: 'The core control-unit logic for any complex digital system or processor.',
      prerequisites: ['A.5', 'A.6'],
      resources: [
        { label: 'Neso Academy — FSM tutorials', url: 'https://www.nesoacademy.org', tier: 'free' },
        { label: 'MIT 6.004 — FSM lectures', url: 'https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/', tier: 'free' },
        { label: '"Advanced Digital Design with Verilog HDL" — Ciletti', url: bookSearch('Advanced Digital Design Verilog Ciletti'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'A.9',
      name: 'Timing Analysis Fundamentals (Setup/Hold, Delay)',
      why: 'Ensures the circuit operates at high clock frequencies without data corruption.',
      prerequisites: ['A.8'],
      resources: [
        { label: 'VLSI Expert Blog (free)', url: 'http://www.vlsi-expert.com', tier: 'free' },
        { label: '"Static Timing Analysis for Nanometer Designs" — J. Bhasker', url: bookSearch('Static Timing Analysis Nanometer Bhasker'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'A.10',
      name: 'Memory (SRAM, DRAM, ROM, Flash, Cache)',
      why: 'Understanding memory architectures is crucial for efficient code and processor design.',
      prerequisites: ['A.5', 'A.8'],
      resources: [
        { label: 'CrashCourse — Computer Science (YouTube)', url: 'https://www.youtube.com/playlist?list=PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo', tier: 'free' },
        { label: '"Computer Organization & Design" — Patterson & Hennessy', url: bookSearch('Computer Organization and Design Patterson Hennessy'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH B — Hardware Description Languages (accentPrimary)
// ---------------------------------------------------------------------------
const branchB: SkillBranch = {
  id: 'B',
  name: 'BRANCH B — HARDWARE DESCRIPTION LANGUAGES',
  tagline: 'Verilog, SystemVerilog and UVM — how chips are actually written',
  accentColor: Palette.accentPrimary,
  skills: [
    {
      id: 'B.1',
      name: 'Verilog Basics (Modules, Ports, Wire, Reg)',
      why: 'The industry-standard language for describing digital hardware circuits.',
      prerequisites: ['A.8'],
      resources: [
        { label: 'ASIC World — Verilog tutorial (free)', url: 'https://www.asic-world.com/verilog/', tier: 'free' },
        { label: 'HDLBits — free interactive', url: 'https://hdlbits.01xz.net', tier: 'free' },
        { label: 'IEEE 1364 Verilog standard', url: 'https://ieeexplore.ieee.org/document/1620780', tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.2',
      name: 'Verilog Behavioral Modeling (Always, If-else, Case)',
      why: 'Design complex logic at a higher level of abstraction than individual gates.',
      prerequisites: ['B.1'],
      resources: [
        { label: 'HDLBits', url: 'https://hdlbits.01xz.net', tier: 'free' },
        { label: '"Verilog HDL" by Samir Palnitkar', url: bookSearch('Verilog HDL Samir Palnitkar'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.3',
      name: 'Verilog Structural Modeling (Instantiation, Generate)',
      why: 'Essential for scalable, hierarchical designs and reusing IP blocks.',
      prerequisites: ['B.2'],
      resources: [
        { label: 'ChipVerify — Verilog tutorial', url: 'https://www.chipverify.com/verilog/verilog-tutorial', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'B.4',
      name: 'Testbench Writing ($display, $monitor, $dumpvars)',
      why: 'Hardware bugs are expensive; simulation via testbenches is the primary way to verify designs.',
      prerequisites: ['B.2'],
      resources: [
        { label: 'EDA Playground — free interactive', url: 'https://www.edaplayground.com', tier: 'free' },
        { label: '"Writing Testbenches using SystemVerilog" — Bergeron', url: bookSearch('Writing Testbenches SystemVerilog Bergeron'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.5',
      name: 'SystemVerilog Extensions (Logic, Interfaces, Modports)',
      why: 'Modernizes Verilog with better data types and interfaces — standard in industry today.',
      prerequisites: ['B.4'],
      resources: [
        { label: 'SystemVerilog.io (free)', url: 'https://www.systemverilog.io', tier: 'free' },
        { label: '"SystemVerilog for Design" — Stuart Sutherland', url: bookSearch('SystemVerilog for Design Sutherland'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.6',
      name: 'SystemVerilog OOP (Classes, Inheritance, Polymorphism)',
      why: 'The foundation for modern verification methodologies like UVM.',
      prerequisites: ['B.5', 'E.2'],
      resources: [
        { label: 'Verification Academy (free registration)', url: 'https://verificationacademy.com', tier: 'free' },
        { label: '"SystemVerilog for Verification" — Chris Spear', url: bookSearch('SystemVerilog for Verification Chris Spear'), tier: 'paid' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'B.7',
      name: 'SystemVerilog Assertions (Immediate & Concurrent)',
      why: 'Enables formal verification and dynamic checking of complex protocol timing rules.',
      prerequisites: ['B.5'],
      resources: [
        { label: 'Doulos — SVA tutorials', url: 'https://www.doulos.com/knowhow/systemverilog/', tier: 'free' },
        { label: '"A Practical Guide for SVA" — Vijayaraghavan', url: bookSearch('Practical Guide SystemVerilog Assertions Vijayaraghavan'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.8',
      name: 'SystemVerilog Functional Coverage (Covergroups, Cross)',
      why: 'Quantifies how much of the design has actually been tested.',
      prerequisites: ['B.6'],
      resources: [
        { label: 'ChipVerify — coverage tutorial', url: 'https://www.chipverify.com/systemverilog/systemverilog-functional-coverage', tier: 'free' },
        { label: 'Verification Academy — Coverage Cookbook', url: 'https://verificationacademy.com/cookbook/coverage', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'B.9',
      name: 'UVM Fundamentals (Agents, Drivers, Monitors, Scoreboards)',
      why: 'The universal standard framework for verifying complex ASIC designs in industry.',
      prerequisites: ['B.6', 'B.8'],
      resources: [
        { label: 'Verification Academy — UVM basics', url: 'https://verificationacademy.com/courses/uvm-basics', tier: 'free' },
        { label: '"UVM Primer" by Ray Salemi', url: bookSearch('UVM Primer Ray Salemi'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'B.10',
      name: 'UVM Advanced (Factory, Register Model, Virtual Sequences)',
      why: 'Mastery lets you handle the most complex SoCs in tier-1 semiconductor companies.',
      prerequisites: ['B.9'],
      resources: [
        { label: 'Cluelogic — UVM tutorial', url: 'http://cluelogic.com/category/uvm/', tier: 'free' },
        { label: 'Verification Academy — UVM Cookbook', url: 'https://verificationacademy.com/cookbook/uvm', tier: 'free' },
      ],
      certification: 'Cadence / Synopsys UVM Certification (~$500, cadence.com)',
      timeToProficiency: '4 weeks',
      cost: 'Free core; optional cert ~$500',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH C — EDA Tools & Flows (accentPrimary)
// ---------------------------------------------------------------------------
const branchC: SkillBranch = {
  id: 'C',
  name: 'BRANCH C — EDA TOOLS & FLOWS',
  tagline: 'From open-source RTL-to-GDS to industry synthesis & P&R',
  accentColor: Palette.accentPrimary,
  skills: [
    {
      id: 'C.1',
      name: 'Icarus Verilog (Open-source compile & simulate)',
      why: 'The most accessible way to compile and simulate Verilog locally without licenses.',
      prerequisites: ['B.1'],
      resources: [
        { label: 'Icarus Verilog documentation', url: 'https://steveicarus.github.io/iverilog/', tier: 'free' },
      ],
      timeToProficiency: '3 days',
      cost: 'Free (open source)',
    },
    {
      id: 'C.2',
      name: 'GTKWave (Waveform viewing)',
      why: 'The standard open-source tool for debugging digital signals visually.',
      prerequisites: ['C.1'],
      resources: [
        { label: 'GTKWave manual', url: 'https://gtkwave.sourceforge.net/gtkwave.pdf', tier: 'free' },
      ],
      timeToProficiency: '2 days',
      cost: 'Free (open source)',
    },
    {
      id: 'C.3',
      name: 'Verilator (Fast cycle-accurate simulation)',
      why: 'Compiles Verilog to C++, enabling insanely fast simulations for large designs like CPUs.',
      prerequisites: ['B.4', 'E.2'],
      resources: [
        { label: 'Verilator manual (free)', url: 'https://www.veripool.org/verilator/', tier: 'free' },
        { label: 'ZipCPU — Verilator tutorial', url: 'https://zipcpu.com/tutorial/', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free (open source)',
    },
    {
      id: 'C.4',
      name: 'Yosys (Open-source synthesis)',
      why: 'Core engine of the open-source hardware movement — translates RTL to gates.',
      prerequisites: ['B.3'],
      resources: [
        { label: 'Yosys README & manual', url: 'https://yosyshq.net/yosys/', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free (open source)',
    },
    {
      id: 'C.5',
      name: 'OpenROAD / OpenLANE (RTL-to-GDS Place & Route)',
      why: 'Lets anyone design a fully layout-ready microchip (RTL-to-GDSII) for free.',
      prerequisites: ['C.4'],
      resources: [
        { label: 'OpenLANE GitHub docs', url: 'https://github.com/The-OpenROAD-Project/OpenLane', tier: 'free' },
        { label: 'Zero to ASIC course — Matt Venn', url: 'https://www.zerotoasiccourse.com', tier: 'paid' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free core; Zero-to-ASIC course optional',
    },
    {
      id: 'C.6',
      name: 'Synopsys Design Compiler (Industry synthesis)',
      why: 'The gold standard for commercial ASIC synthesis — essential for industry jobs.',
      prerequisites: ['B.3', 'A.9'],
      resources: [
        { label: 'University VLSI lab manuals', url: 'https://www.synopsys.com/community/university-program.html', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Academic license (via university)',
    },
    {
      id: 'C.7',
      name: 'Cadence Innovus (Industry P&R)',
      why: 'Industry-standard physical design tool for placing millions of gates.',
      prerequisites: ['C.6'],
      resources: [
        { label: 'VLSI Expert — Physical Design tutorials', url: 'http://www.vlsi-expert.com', tier: 'free' },
      ],
      certification: 'Cadence Digital Design Certification (~$600, cadence.com)',
      timeToProficiency: '4 weeks',
      cost: 'Academic license; optional cert ~$600',
    },
    {
      id: 'C.8',
      name: 'Mentor Questa / ModelSim (Industry simulation)',
      why: 'The industry standard for SystemVerilog and UVM simulation.',
      prerequisites: ['B.5'],
      resources: [
        { label: 'ModelSim Student Edition', url: 'https://www.intel.com/content/www/us/en/software-kit/750368/modelsim-intel-fpgas-standard-edition-software-version-20-1-1.html', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free (student edition)',
    },
    {
      id: 'C.9',
      name: 'Xilinx Vivado (FPGA synthesis)',
      why: 'Essential for deploying digital designs onto real physical FPGA hardware.',
      prerequisites: ['B.3'],
      resources: [
        { label: 'Digilent — Vivado tutorials', url: 'https://digilent.com/reference/programmable-logic/guides/getting-started-with-vivado', tier: 'free' },
      ],
      certification: 'AMD/Xilinx Certified Professional (cost varies, amd.com)',
      timeToProficiency: '3 weeks',
      cost: 'Free (WebPACK edition)',
    },
    {
      id: 'C.10',
      name: 'MATLAB / Simulink (System-level modeling)',
      why: 'Used for architectural exploration and DSP algorithm design before writing RTL.',
      prerequisites: ['High School Math'],
      resources: [
        { label: 'MATLAB Onramp (free)', url: 'https://matlabacademy.mathworks.com/details/matlab-onramp/gettingstarted', tier: 'free' },
      ],
      certification: 'MathWorks Certified MATLAB Associate ($150, mathworks.com)',
      timeToProficiency: '3 weeks',
      cost: 'Free onramp; license via university; cert $150',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH D — Computer Architecture (accentInfo)
// ---------------------------------------------------------------------------
const branchD: SkillBranch = {
  id: 'D',
  name: 'BRANCH D — COMPUTER ARCHITECTURE',
  tagline: 'ISAs, pipelines, caches and accelerators — how CPUs work',
  accentColor: Palette.accentInfo,
  skills: [
    {
      id: 'D.1',
      name: 'ISA Design (RISC vs CISC, instruction formats)',
      why: 'The software/hardware interface; dictates how a CPU fundamentally works.',
      prerequisites: ['A.10'],
      resources: [
        { label: 'RISC-V Reader (book)', url: 'http://www.riscvbook.com', tier: 'paid' },
        { label: '"Computer Organization & Design" — Patterson & Hennessy', url: bookSearch('Computer Organization and Design RISC-V'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free ISA specs; textbook optional',
    },
    {
      id: 'D.2',
      name: 'Single-Cycle Datapath',
      why: 'The simplest implementation of a CPU, executing one instruction per clock.',
      prerequisites: ['D.1', 'A.4'],
      resources: [
        { label: 'NPTEL — Computer Architecture', url: 'https://nptel.ac.in/courses/106105163', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'D.3',
      name: 'Multi-Cycle Datapath',
      why: 'Breaks instructions into steps, allowing shared hardware across cycles.',
      prerequisites: ['D.2'],
      resources: [
        { label: 'Patterson & Hennessy — Chapter 4', url: bookSearch('Computer Organization and Design Patterson Hennessy'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'D.4',
      name: 'Pipelining (5-stage, data/control/structural hazards)',
      why: 'The key to high clock speeds and throughput in modern processors.',
      prerequisites: ['D.3'],
      resources: [
        { label: "Onur Mutlu — Computer Architecture (YouTube)", url: 'https://www.youtube.com/@OnurMutluLectures', tier: 'free' },
        { label: '"Computer Architecture: A Quantitative Approach"', url: bookSearch('Computer Architecture A Quantitative Approach Hennessy Patterson'), tier: 'paid' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'D.5',
      name: 'Hazard Resolution (Forwarding, Stalling, Branch Prediction)',
      why: 'Keeps the pipeline from stalling — maximizing IPC (instructions per cycle).',
      prerequisites: ['D.4'],
      resources: [
        { label: 'Onur Mutlu — Branch Prediction lecture', url: 'https://www.youtube.com/@OnurMutluLectures', tier: 'free' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'D.6',
      name: 'Cache Design (Direct-mapped, Set-associative, LRU)',
      why: 'Memory is slow; caches are required to keep the CPU fed with data.',
      prerequisites: ['A.10', 'D.5'],
      resources: [
        { label: '"A Primer on Memory Consistency & Cache Coherence"', url: 'https://link.springer.com/book/10.1007/978-3-031-01764-3', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'D.7',
      name: 'Virtual Memory & TLB',
      why: 'Allows secure, isolated multi-tasking operating systems like Linux to run.',
      prerequisites: ['D.6'],
      resources: [
        { label: 'OSDev Wiki — Paging', url: 'https://wiki.osdev.org/Paging', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'D.8',
      name: 'Superscalar & Out-of-Order Execution',
      why: 'How modern high-performance CPUs (Intel Core, Apple M-series) actually work.',
      prerequisites: ['D.5'],
      resources: [
        { label: 'Onur Mutlu — Advanced Computer Architecture', url: 'https://www.youtube.com/@OnurMutluLectures', tier: 'free' },
        { label: '"Modern Processor Design" — Shen & Lipasti', url: bookSearch('Modern Processor Design Shen Lipasti'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'D.9',
      name: 'GPU Architecture Fundamentals',
      why: 'Dominant architecture for parallel computing, ML training, and graphics.',
      prerequisites: ['D.4'],
      resources: [
        { label: 'CUDA C++ Programming Guide', url: 'https://docs.nvidia.com/cuda/cuda-c-programming-guide/', tier: 'free' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'D.10',
      name: 'Domain-Specific Accelerators (TPU, NPU, VPU)',
      why: 'The future of architecture — custom silicon for AI and specific workloads.',
      prerequisites: ['D.8', 'H.2'],
      resources: [
        { label: 'Google TPU whitepaper', url: 'https://arxiv.org/abs/1704.04760', tier: 'free' },
        { label: 'MIT 6.5930 — HW for Deep Learning', url: 'https://ocw.mit.edu', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH E — Programming & Scripting (accentPrimary)
// ---------------------------------------------------------------------------
const branchE: SkillBranch = {
  id: 'E',
  name: 'BRANCH E — PROGRAMMING & SCRIPTING',
  tagline: 'C/C++, Python, TCL and the Linux toolchain that runs VLSI',
  accentColor: Palette.accentPrimary,
  skills: [
    {
      id: 'E.1',
      name: 'C Programming (Pointers, Memory, Data Structures)',
      why: 'Essential for embedded systems, firmware, and low-level hardware drivers.',
      prerequisites: ['Basic Computer Literacy'],
      resources: [
        { label: 'CS50x (free)', url: 'https://cs50.harvard.edu/x/', tier: 'free' },
        { label: '"The C Programming Language" — K&R', url: bookSearch('The C Programming Language Kernighan Ritchie'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'E.2',
      name: 'C++ (OOP, STL, Templates)',
      why: 'Used for EDA tool development, HLS, and fast system simulators (Verilator).',
      prerequisites: ['E.1'],
      resources: [
        { label: 'LearnCpp.com', url: 'https://www.learncpp.com', tier: 'free' },
        { label: '"Effective C++" — Scott Meyers', url: bookSearch('Effective C++ Scott Meyers'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'E.3',
      name: 'Python (Scripting, Automation, Data Analysis)',
      why: 'The glue of modern engineering — ML, automation, and verification (Cocotb).',
      prerequisites: ['Basic Computer Literacy'],
      resources: [
        { label: 'Automate the Boring Stuff (free)', url: 'https://automatetheboringstuff.com', tier: 'free' },
        { label: '"Fluent Python" — Luciano Ramalho', url: bookSearch('Fluent Python Luciano Ramalho'), tier: 'paid' },
      ],
      certification: 'PCAP ($295, pythoninstitute.org)',
      timeToProficiency: '3 weeks',
      cost: 'Free core; optional cert $295',
    },
    {
      id: 'E.4',
      name: 'TCL (EDA tool scripting)',
      why: 'The universal scripting language used by every major EDA tool (Synopsys, Cadence, Xilinx).',
      prerequisites: ['E.3'],
      resources: [
        { label: 'Tcl Tutorial', url: 'https://www.tcl.tk/man/tcl8.5/tutorial/tcltutorial.html', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'E.5',
      name: 'Perl (Legacy EDA scripting)',
      why: 'Still heavily used in legacy verification environments and text processing.',
      prerequisites: ['E.3'],
      resources: [
        { label: 'Perl Tutorial', url: 'https://www.perltutorial.org', tier: 'free' },
        { label: '"Learning Perl" (O\'Reilly)', url: bookSearch('Learning Perl OReilly'), tier: 'paid' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'E.6',
      name: 'Shell / Bash (Linux command line)',
      why: 'All VLSI and hardware design happens on Linux servers; shell mastery is mandatory.',
      prerequisites: ['Basic Computer Literacy'],
      resources: [
        { label: 'Linux Journey (free)', url: 'https://linuxjourney.com', tier: 'free' },
        { label: '"The Linux Command Line" — W. Shotts', url: 'https://linuxcommand.org/tlcl.php', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'E.7',
      name: 'Makefile & Build Systems',
      why: 'Automates compilation and simulation flows, saving thousands of hours.',
      prerequisites: ['E.6'],
      resources: [
        { label: 'Makefile Tutorial by Example (free)', url: 'https://makefiletutorial.com', tier: 'free' },
        { label: 'GNU Make manual', url: 'https://www.gnu.org/software/make/manual/', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'E.8',
      name: 'Git & Version Control',
      why: 'Essential for team collaboration, tracking RTL changes, and avoiding disasters.',
      prerequisites: ['E.6'],
      resources: [
        { label: 'Pro Git book (free online)', url: 'https://git-scm.com/book/en/v2', tier: 'free' },
        { label: 'Learn Git Branching (interactive)', url: 'https://learngitbranching.js.org', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'E.9',
      name: 'Linux System Administration',
      why: 'You will often need to manage your own workstation or EDA server environment.',
      prerequisites: ['E.6'],
      resources: [
        { label: 'Red Hat — Sysadmin basics', url: 'https://www.redhat.com/en/services/training', tier: 'free' },
        { label: '"UNIX and Linux System Administration Handbook"', url: bookSearch('UNIX and Linux System Administration Handbook'), tier: 'paid' },
      ],
      certification: 'RHCSA ($400, redhat.com)',
      timeToProficiency: '3 weeks',
      cost: 'Free core; optional cert $400',
    },
    {
      id: 'E.10',
      name: 'Docker & Containers',
      why: 'Ensures reproducible build and simulation environments across machines.',
      prerequisites: ['E.9'],
      resources: [
        { label: 'Docker 101 tutorial', url: 'https://www.docker.com/101-tutorial/', tier: 'free' },
      ],
      certification: 'Docker Certified Associate ($195, docker.com)',
      timeToProficiency: '2 weeks',
      cost: 'Free core; optional cert $195',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH F — Analog & Mixed-Signal (accentWarning)
// ---------------------------------------------------------------------------
const branchF: SkillBranch = {
  id: 'F',
  name: 'BRANCH F — ANALOG & MIXED-SIGNAL',
  tagline: 'Optional but powerful — transistors, amplifiers, ADCs and PLLs',
  accentColor: Palette.accentWarning,
  skills: [
    {
      id: 'F.1',
      name: 'MOSFET Physics',
      why: 'The fundamental building block of all modern chips; its non-idealities are crucial.',
      prerequisites: ['High School Physics'],
      resources: [
        { label: 'NPTEL — Basic Electronics', url: 'https://nptel.ac.in/courses/108102112', tier: 'free' },
        { label: '"Solid State Electronic Devices" — Streetman', url: bookSearch('Solid State Electronic Devices Streetman'), tier: 'paid' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'F.2',
      name: 'CMOS Inverter Analysis',
      why: 'The gateway to digital VLSI — explains delay, power dissipation, and noise margins.',
      prerequisites: ['F.1'],
      resources: [
        { label: '"CMOS VLSI Design" — Neil Weste (Ch. 2)', url: bookSearch('CMOS VLSI Design Weste Harris'), tier: 'paid' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free (SPICE tools) + textbook',
    },
    {
      id: 'F.3',
      name: 'Amplifier Design (CS, CG, CD)',
      why: 'The basis of all analog circuits, sensor interfaces, and RF design.',
      prerequisites: ['F.2'],
      resources: [
        { label: 'Behzad Razavi — Electronics lectures (YouTube)', url: 'https://www.youtube.com/results?search_query=behzad+razavi+analog+cmos', tier: 'free' },
        { label: '"Design of Analog CMOS ICs" — Razavi', url: bookSearch('Design of Analog CMOS Integrated Circuits Razavi'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free lectures; textbook optional',
    },
    {
      id: 'F.4',
      name: 'Op-Amp Design',
      why: 'The most versatile analog block — used in filters, ADCs, and power management.',
      prerequisites: ['F.3'],
      resources: [
        { label: 'Razavi — Op-Amp lectures', url: 'https://www.youtube.com/results?search_query=razavi+op+amp+design', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'F.5',
      name: 'ADC / DAC Fundamentals',
      why: 'Bridges the analog physical world with the digital processing world.',
      prerequisites: ['F.4', 'A.4'],
      resources: [
        { label: 'Analog Devices — Data Conversion Handbook', url: 'https://www.analog.com/en/resources/technical-books/data-conversion-handbook.html', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'F.6',
      name: 'PLL Design',
      why: 'Generates the high-speed, stable clock signals required by all modern digital chips.',
      prerequisites: ['F.4', 'A.8'],
      resources: [
        { label: 'Ali Hajimiri — PLL tutorials', url: 'https://www.youtube.com/results?search_query=ali+hajimiri+pll', tier: 'free' },
        { label: '"Design of CMOS Phase-Locked Loops" — Razavi', url: bookSearch('Design of CMOS Phase-Locked Loops Razavi'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free lectures; textbook optional',
    },
    {
      id: 'F.7',
      name: 'Power Management IC Design',
      why: 'Every chip needs clean, stable power; PMICs are a massive industry on their own.',
      prerequisites: ['F.4'],
      resources: [
        { label: 'TI — Power Management training', url: 'https://www.ti.com/power-management/overview.html', tier: 'free' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH G — Soft Skills & Career (accentPurple)
// ---------------------------------------------------------------------------
const branchG: SkillBranch = {
  id: 'G',
  name: 'BRANCH G — SOFT SKILLS & CAREER',
  tagline: 'Writing, German, GRE/IELTS and everything that lands the offer',
  accentColor: Palette.accentPurple,
  skills: [
    {
      id: 'G.1',
      name: 'Technical Writing (IEEE format papers)',
      why: 'Clear communication of research is mandatory for TU9 applications and academia.',
      prerequisites: ['None'],
      resources: [
        { label: 'IEEE Author Center (free)', url: 'https://ieeeauthorcenter.ieee.org', tier: 'free' },
        { label: '"The Craft of Scientific Writing" — Michael Alley', url: bookSearch('The Craft of Scientific Writing Alley'), tier: 'paid' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free',
    },
    {
      id: 'G.2',
      name: 'Presentation Skills',
      why: 'You must be able to defend your design choices and present findings effectively.',
      prerequisites: ['None'],
      resources: [
        { label: 'Toastmasters — resources', url: 'https://www.toastmasters.org', tier: 'free' },
        { label: '"TED Talks: The Official TED Guide to Public Speaking"', url: bookSearch('TED Talks Official Guide Public Speaking'), tier: 'paid' },
      ],
      timeToProficiency: 'Ongoing',
      cost: 'Free',
    },
    {
      id: 'G.3',
      name: 'LinkedIn Profile Optimization',
      why: 'Your digital resume — critical for jobs, internships, and networking with German professors.',
      prerequisites: ['None'],
      resources: [
        { label: 'LinkedIn optimization guides (YouTube)', url: 'https://www.youtube.com/results?search_query=linkedin+profile+optimization+engineer', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'G.4',
      name: 'GitHub Profile Optimization',
      why: 'Open-source hardware contributions prove you can actually write code and design chips.',
      prerequisites: ['E.8'],
      resources: [
        { label: 'GitHub Docs', url: 'https://docs.github.com', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'G.5',
      name: 'Resume / CV Writing (international applications)',
      why: 'Europass or standard German CV format is required for TU9 applications.',
      prerequisites: ['None'],
      resources: [
        { label: 'Europass CV builder (free)', url: 'https://europa.eu/europass/en', tier: 'free' },
      ],
      timeToProficiency: '1 week',
      cost: 'Free',
    },
    {
      id: 'G.6',
      name: 'Interview Preparation (VLSI design interviews)',
      why: 'Getting the degree is step 1; passing the technical gauntlet is step 2.',
      prerequisites: ['Branches A, B, C, D'],
      resources: [
        { label: 'Glassdoor — VLSI interview questions', url: 'https://www.glassdoor.com', tier: 'free' },
        { label: '"Cracking the Digital VLSI Verification Interview" — Ramdas', url: bookSearch('Cracking the Digital VLSI Verification Interview Ramdas'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'G.7',
      name: 'German Language (A1 → A2 → B1)',
      why: 'Crucial for daily life, internships, and networking — even if the MS is in English.',
      prerequisites: ['None'],
      resources: [
        { label: 'DW Learn German — Nicos Weg (free)', url: 'https://learngerman.dw.com', tier: 'free' },
        { label: 'Duolingo (free)', url: 'https://www.duolingo.com', tier: 'free' },
        { label: 'Goethe-Institut courses', url: 'https://www.goethe.de', tier: 'paid' },
      ],
      certification: 'Goethe-Zertifikat B1 (~€200, goethe.de)',
      timeToProficiency: '6–12 months',
      cost: 'Free self-study; cert ~€200',
    },
    {
      id: 'G.8',
      name: 'GRE Quantitative (Target: 165+)',
      why: 'Many top MS programs use GRE as a hard filter for international applicants.',
      prerequisites: ['High School Math'],
      resources: [
        { label: 'ETS Official GRE prep (free)', url: 'https://www.ets.org/gre', tier: 'free' },
        { label: 'GregMat (~$5/mo)', url: 'https://www.gregmat.com', tier: 'paid' },
      ],
      certification: 'Official GRE score (~$220, ets.org)',
      timeToProficiency: '2 months',
      cost: 'Exam ~$220; prep ~$5/mo',
    },
    {
      id: 'G.9',
      name: 'IELTS / TOEFL (Target: 7.0+ / 100+)',
      why: 'Mandatory proof of English proficiency for university admission and visas.',
      prerequisites: ['None'],
      resources: [
        { label: 'IELTS Liz (free website)', url: 'https://ieltsliz.com', tier: 'free' },
        { label: 'Cambridge IELTS practice tests', url: bookSearch('Cambridge IELTS practice tests'), tier: 'paid' },
      ],
      certification: 'Official IELTS / TOEFL score (~$250)',
      timeToProficiency: '1 month',
      cost: 'Exam ~$250',
    },
    {
      id: 'G.10',
      name: 'Networking & Professional Branding',
      why: 'The hidden job market is accessed entirely through who you know and who knows your work.',
      prerequisites: ['G.3'],
      resources: [
        { label: '"Never Eat Alone" — Keith Ferrazzi', url: bookSearch('Never Eat Alone Keith Ferrazzi'), tier: 'paid' },
        { label: 'Local IEEE / ACM chapters', url: 'https://www.ieee.org/communities/index.html', tier: 'free' },
      ],
      timeToProficiency: 'Ongoing',
      cost: 'Free',
    },
  ],
};

// ---------------------------------------------------------------------------
// BRANCH H — Experimental & Future Tech (accentInfo)
// ---------------------------------------------------------------------------
const branchH: SkillBranch = {
  id: 'H',
  name: 'BRANCH H — EXPERIMENTAL & FUTURE TECH',
  tagline: 'ML hardware, RISC-V, quantum, photonics and open silicon',
  accentColor: Palette.accentInfo,
  skills: [
    {
      id: 'H.1',
      name: 'Machine Learning Fundamentals',
      why: 'AI is reshaping EDA and architecture; hardware engineers must know software AI.',
      prerequisites: ['E.3'],
      resources: [
        { label: 'Andrew Ng — ML Specialization (Coursera)', url: 'https://www.coursera.org/specializations/machine-learning-introduction', tier: 'free' },
        { label: '"Hands-On Machine Learning" — Géron', url: bookSearch('Hands-On Machine Learning Scikit-Learn Keras TensorFlow'), tier: 'paid' },
      ],
      certification: 'DeepLearning.AI ML Certificate (~$49/mo, coursera.org)',
      timeToProficiency: '4 weeks',
      cost: 'Free audit; cert ~$49/mo',
    },
    {
      id: 'H.2',
      name: 'Deep Learning (CNNs, Transformers)',
      why: 'The dominant AI architectures that domain-specific hardware (TPUs) is built to accelerate.',
      prerequisites: ['H.1'],
      resources: [
        { label: 'Fast.ai — Practical Deep Learning', url: 'https://course.fast.ai', tier: 'free' },
        { label: 'PyTorch documentation', url: 'https://pytorch.org/tutorials/', tier: 'free' },
        { label: '"Deep Learning" — Goodfellow', url: 'https://www.deeplearningbook.org', tier: 'free' },
      ],
      certification: 'DeepLearning.AI DL Certificate (~$49/mo, coursera.org)',
      timeToProficiency: '4 weeks',
      cost: 'Free; cert ~$49/mo',
    },
    {
      id: 'H.3',
      name: 'TinyML (Edge AI on microcontrollers)',
      why: 'Bringing AI to extreme low-power embedded devices — highly relevant to ECE.',
      prerequisites: ['H.2', 'E.1'],
      resources: [
        { label: 'Harvard TinyML course (edX)', url: 'https://www.edx.org/learn/machine-learning/harvard-university-fundamentals-of-tinyml', tier: 'free' },
        { label: '"TinyML" — Pete Warden', url: bookSearch('TinyML Pete Warden'), tier: 'paid' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free audit',
    },
    {
      id: 'H.4',
      name: 'LLM Fundamentals & Prompt Engineering',
      why: 'Leveraging AI to write RTL, debug testbenches, and accelerate workflows.',
      prerequisites: ['E.3'],
      resources: [
        { label: 'OpenAI API documentation', url: 'https://platform.openai.com/docs', tier: 'free' },
        { label: 'DeepLearning.AI — Prompt Engineering', url: 'https://www.deeplearning.ai/short-courses/chatgpt-prompt-engineering-for-developers/', tier: 'free' },
      ],
      timeToProficiency: '2 weeks',
      cost: 'Free',
    },
    {
      id: 'H.5',
      name: 'Agentic AI Systems',
      why: 'The next step in automation — AI agents that autonomously run EDA toolchains.',
      prerequisites: ['H.4'],
      resources: [
        { label: 'LangChain documentation', url: 'https://python.langchain.com', tier: 'free' },
      ],
      timeToProficiency: '3 weeks',
      cost: 'Free (API usage billed)',
    },
    {
      id: 'H.6',
      name: 'Quantum Computing Basics (Qubits, Gates, Circuits)',
      why: 'The ultimate hardware frontier — potentially disrupts classical computing limits.',
      prerequisites: ['High School Physics', 'Linear Algebra'],
      resources: [
        { label: 'IBM Quantum Learning (free)', url: 'https://learning.quantum.ibm.com', tier: 'free' },
        { label: '"Quantum Computation & Quantum Information" — Nielsen & Chuang', url: bookSearch('Quantum Computation and Quantum Information Nielsen Chuang'), tier: 'paid' },
      ],
      certification: 'IBM Certified Associate Developer — Quantum ($200, ibm.com)',
      timeToProficiency: '4 weeks',
      cost: 'Free core; optional cert $200',
    },
    {
      id: 'H.7',
      name: 'Neuromorphic Computing',
      why: 'Brain-inspired hardware (like Intel Loihi) for ultra-low power spiking neural networks.',
      prerequisites: ['D.10', 'F.2'],
      resources: [
        { label: 'Intro to Neuromorphic Engineering (YouTube)', url: 'https://www.youtube.com/results?search_query=introduction+to+neuromorphic+engineering', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'H.8',
      name: 'Photonic Computing',
      why: 'Using light instead of electrons for ultra-fast, low-power interconnects and compute.',
      prerequisites: ['F.1'],
      resources: [
        { label: 'NPTEL — Optoelectronics', url: 'https://nptel.ac.in/courses/108108126', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free',
    },
    {
      id: 'H.9',
      name: 'RISC-V Ecosystem',
      why: 'The open-source ISA revolutionizing computer architecture and SoC design.',
      prerequisites: ['D.1'],
      resources: [
        { label: 'RISC-V International (YouTube)', url: 'https://www.youtube.com/@riscv', tier: 'free' },
        { label: 'Ibex / PicoRV32 open cores', url: 'https://github.com/lowRISC/ibex', tier: 'free' },
      ],
      certification: 'RISC-V Foundational Associate — RVFA ($250, linuxfoundation.org)',
      timeToProficiency: '3 weeks',
      cost: 'Free core; optional cert $250',
    },
    {
      id: 'H.10',
      name: 'Open Source Silicon (Tiny Tapeout, SkyWater PDK)',
      why: 'Lets anyone actually manufacture a physical chip they designed, for very cheap or free.',
      prerequisites: ['C.5'],
      resources: [
        { label: 'TinyTapeout.com', url: 'https://tinytapeout.com', tier: 'free' },
        { label: 'Caravel SoC template (Efabless)', url: 'https://github.com/efabless/caravel', tier: 'free' },
      ],
      timeToProficiency: '4 weeks',
      cost: 'Free tooling; tape-out from ~$100 (Tiny Tapeout)',
    },
  ],
};

export const SKILL_BRANCHES: SkillBranch[] = [
  branchA,
  branchB,
  branchC,
  branchD,
  branchE,
  branchF,
  branchG,
  branchH,
];

// ===========================================================================
// GERMANY ROADMAP (docs/01_GERMANY_ROADMAP.md)
// ===========================================================================

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

export interface CostItem {
  label: string;
  amount: string;
  note: string;
}

export const ROADMAP_COSTS: CostItem[] = [
  {
    label: 'Blocked Account (Sperrkonto)',
    amount: '~€11,208 / year',
    note: '€934/month withdrawal limit. Providers: Expatrio, Coracle, Fintiba. Required for the visa.',
  },
  {
    label: 'Health Insurance',
    amount: '~€120–130 / month',
    note: 'Mandatory. Public providers recommended: TK, AOK, Barmer.',
  },
  {
    label: 'Semester Contribution',
    amount: '€150–350 / semester',
    note: 'Admin fees + student union; often includes a semester transport ticket.',
  },
  {
    label: 'Cost of Living — Munich',
    amount: '~€1,000–1,300 / month',
    note: 'Very high rent.',
  },
  {
    label: 'Cost of Living — Aachen / Dresden',
    amount: '~€700–900 / month',
    note: 'More affordable university cities.',
  },
  {
    label: 'APS Certificate',
    amount: '~₹18,000',
    note: 'Verification of Indian academic documents. Takes 2–6 months — apply early.',
  },
];

export interface RoadmapPhase {
  window: string;
  actions: string[];
}

export const ROADMAP_TIMELINE: RoadmapPhase[] = [
  {
    window: 'Jul–Dec 2026',
    actions: ['Start German (target A2/B1 by 2027)', 'Prep & take GRE + IELTS by Dec 2026'],
  },
  {
    window: 'Jan–Jun 2027',
    actions: ['Gather all transcripts', 'Apply for APS Certificate (crucial bottleneck)'],
  },
  {
    window: 'Jul–Dec 2027',
    actions: ['Shortlist universities & check module requirements', 'Draft SOPs; secure LORs'],
  },
  {
    window: 'Jan–Mar 2028',
    actions: ['Winter-semester portals open', 'Submit applications (direct or via uni-assist)'],
  },
  {
    window: 'Apr–Jun 2028',
    actions: ['Admission results arrive', 'Accept offer; open Blocked Account & transfer funds'],
  },
  {
    window: 'Jul–Oct 2028',
    actions: ['Apply for student visa', 'Arrive, register (Anmeldung), enroll — classes begin October'],
  },
];

// ===========================================================================
// CAREER VERTICALS (docs/02_CAREER_VERTICALS.md)
// ===========================================================================

export interface CareerVertical {
  id: number;
  name: string;
  endgame: string;
  responsibilities: string;
  targetCompanies: string[];
  salaryEU: string;
  salaryUS: string;
  accentColor: string;
}

export const CAREER_VERTICALS: CareerVertical[] = [
  {
    id: 1,
    name: 'VLSI / ASIC Design Engineer',
    endgame: 'Architecting the silicon brains behind everything from phones to supercomputers, hitting aggressive Power/Performance/Area goals.',
    responsibilities: 'RTL design, Logic Synthesis, Place & Route, STA, Design for Testability.',
    targetCompanies: ['Intel', 'AMD', 'Qualcomm', 'TSMC', 'Samsung', 'Infineon', 'NXP', 'Apple'],
    salaryEU: '€60k → €95k → €140k+',
    salaryUS: '$120k → $180k → $350k+',
    accentColor: Palette.accentInfo,
  },
  {
    id: 2,
    name: 'Design Verification Engineer',
    endgame: 'Ensuring a multi-billion-transistor chip works before the $100M tape-out. DV engineers write more code than designers.',
    responsibilities: 'UVM testbenches, Formal Verification, Coverage-Driven Verification, Hardware Emulation.',
    targetCompanies: ['Apple', 'Nvidia', 'Arm', 'Broadcom', 'Marvell'],
    salaryEU: '€65k → €100k → €150k+',
    salaryUS: '$130k → $200k → $400k+',
    accentColor: Palette.accentPrimary,
  },
  {
    id: 3,
    name: 'Embedded Systems Engineer',
    endgame: 'Bridging physical and digital worlds — code running on the metal under strict timing, memory and battery constraints.',
    responsibilities: 'RTOS, bare-metal firmware, ARM Cortex-M, device drivers, PCB bring-up.',
    targetCompanies: ['Bosch', 'Continental', 'Tesla', 'Rivian', 'SpaceX', 'STMicroelectronics'],
    salaryEU: '€55k → €85k → €120k+',
    salaryUS: '$110k → $160k → $250k+',
    accentColor: Palette.accentPrimary,
  },
  {
    id: 4,
    name: 'AI / ML Hardware Architect',
    endgame: 'Building the specialized compute engines behind the AI revolution — spatial and in-memory architectures beyond Von Neumann.',
    responsibilities: 'Custom accelerators, TPU design, Network-on-Chip, HW/SW co-design.',
    targetCompanies: ['Google (TPU)', 'Nvidia', 'Cerebras', 'Graphcore', 'd-Matrix', 'Groq', 'Tenstorrent'],
    salaryEU: '€80k → €120k → €180k+',
    salaryUS: '$150k → $250k → $500k+',
    accentColor: Palette.accentInfo,
  },
  {
    id: 5,
    name: 'Quantum Computing Engineer',
    endgame: 'Manipulating qubits at the frontier of ECE — microwave engineering, cryogenics, and quantum mechanics combined.',
    responsibilities: 'Qubit control electronics, cryogenic circuit design, microwave engineering, QEC hardware.',
    targetCompanies: ['IBM Quantum', 'Google Quantum AI', 'IQM', 'PsiQuantum', 'Rigetti'],
    salaryEU: '€75k → €115k → €160k+',
    salaryUS: '$140k → $200k → $350k+',
    accentColor: Palette.accentInfo,
  },
  {
    id: 6,
    name: 'Robotics & Autonomous Systems',
    endgame: 'Building machines that perceive, plan and act in the physical world without human intervention.',
    responsibilities: 'Sensor fusion (LiDAR/Radar/Vision), SLAM, motor controllers, perception pipelines.',
    targetCompanies: ['Boston Dynamics', 'ABB', 'KUKA', 'Waymo', 'Cruise', 'Zoox'],
    salaryEU: '€65k → €95k → €140k+',
    salaryUS: '$120k → $180k → $300k+',
    accentColor: Palette.accentPrimary,
  },
  {
    id: 7,
    name: 'Research Scientist',
    endgame: 'Advancing human knowledge — inventing the architectures, materials and algorithms the industry uses ten years later.',
    responsibilities: 'Novel research, publishing at ISSCC/DAC/ISCA, mentoring PhDs, securing funding.',
    targetCompanies: ['Max Planck', 'Fraunhofer', 'TU9 Universities', 'imec', 'MIT Lincoln Lab'],
    salaryEU: '€50k → €80k → €120k+ (W3 Prof)',
    salaryUS: 'Varies (academia / industry labs)',
    accentColor: Palette.accentPurple,
  },
  {
    id: 8,
    name: 'Semiconductor Startup Founder',
    endgame: 'Building a deep-tech empire from the ground up — the technical depth to architect the product and the acumen to raise $100M+.',
    responsibilities: 'Pitching VCs, recruiting top talent, product architecture, supply-chain (TSMC allocation).',
    targetCompanies: ['Tenstorrent', 'Esperanto', 'Nvidia', 'Tier-1 VC-backed deep tech'],
    salaryEU: 'Equity-driven (defensible IP + large TAM)',
    salaryUS: 'Equity-driven (Tier-1 VC rounds)',
    accentColor: Palette.accentPurple,
  },
];
