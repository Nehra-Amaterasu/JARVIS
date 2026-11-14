"""Ten invented question papers, written as data (E06 acceptance 1). Every subject, heading and question
here is made up for the tests; none is copied from a real paper.

A page is a list of lines, laid top to bottom by build.py:
    "text"                                   at the left margin (x = 72)
    {"t": text, "x": 90}                     indented (a sub-part, an option)
    {"t": text, "r": "5"}                    with a number alone at the right edge (x = 530)
    {"t": text, "c": True}                   centred (a title, an OR line)
    {"gap": 300}                             empty space, to push a question to the foot of a page
    {"table": {"cols": [...], "rows": [[...], ...]}}   ruled table drawn with lines
A page can be {"image": [lines]}: the lines are rendered to a picture and the page holds only that
picture, so it has no text layer (acceptance 4).

`expect` is the hand count: one entry per question as a reader would number it, with the printed
marks (None where the paper prints none), and, where it matters, the section, OR group, parts, type,
CO and BL. Slides list only their headings.
"""

SIGNALS_BASIC = {
    "name": "signals_basic", "subject": "signals",
    "pages": [[
        {"t": "Practice Test in Signals", "c": True},
        "Max. Marks: 30          Time: 1 hour",
        {"gap": 8},
        "1. Define a continuous-time signal and give two examples. [2]",
        "2. State the sampling theorem for a band-limited signal. [3]",
        "3. Find the energy of the signal x(t) = 2 for 0 < t < 3 and zero elsewhere. [5]",
        "4. Derive the Fourier series coefficients of a periodic square wave",
        "with period T and a duty cycle of one half. [10]",
        "5. Explain the difference between energy signals and power signals. [5]",
        "6. Compute the convolution of two rectangular pulses of width 2 s each. [5]",
    ]],
    "expect": {"total": 30, "questions": [
        {"label": "1", "marks": 2, "type": "short"}, {"label": "2", "marks": 3, "type": "short"},
        {"label": "3", "marks": 5, "type": "numerical"}, {"label": "4", "marks": 10, "type": "derivation"},
        {"label": "5", "marks": 5, "type": "descriptive"}, {"label": "6", "marks": 5, "type": "numerical"}]},
}

CIRCUITS_SECTIONS = {
    "name": "circuits_sections", "subject": "circuits",
    "pages": [[
        {"t": "Mid-term Practice in Circuits", "c": True},
        "Total: 22 marks",
        {"gap": 6},
        "Section A",
        "Answer all questions.",
        "Q1. State the current law of Kirchhoff for a node. (2 marks)",
        "Q2. Define the time constant of a series RC circuit. (2 marks)",
        "Q3. List the three passive elements used in circuits. (2 marks)",
        {"gap": 6},
        "SECTION B",
        "Answer any two questions.",
        "Q4. Calculate the current through a 10 ohm resistor",
        "connected across an ideal 5 V source. (8 marks)",
        "Q5. Determine the Thevenin equivalent of a bridge of four 2 kohm arms. (8 marks)",
        "Q6. Explain the maximum power transfer theorem with a diagram. (8 marks)",
    ]],
    "expect": {"total": 22, "questions": [
        {"label": "1", "marks": 2, "section": "A"}, {"label": "2", "marks": 2, "section": "A"},
        {"label": "3", "marks": 2, "section": "A"}, {"label": "4", "marks": 8, "section": "B", "type": "numerical"},
        {"label": "5", "marks": 8, "section": "B", "type": "numerical"}, {"label": "6", "marks": 8, "section": "B"}]},
}

TABLE_PAPER = {
    "name": "table_paper", "subject": "fields",
    "pages": [[
        {"t": "Quiz in Electromagnetic Fields", "c": True},
        "Max. Marks: 20",
        {"gap": 10},
        {"table": {"cols": ["Q", "Question", "Marks", "CO", "BL"], "widths": [30, 350, 40, 35, 35], "rows": [
            ["1", "Define electric flux density.", "2", "CO1", "1"],
            ["2", "State the law of Gauss in integral form.", "2", "CO1", "2"],
            ["3", "Find the field of an infinite line charge of 2 nC/m at 1 m.", "4", "CO2", "3"],
            ["4", "Derive the capacitance of a parallel plate capacitor.", "6", "CO2", "4"],
            ["5", "Design a coaxial line for a given impedance and justify it.", "6", "CO3", "6"]]}},
    ]],
    "expect": {"total": 20, "table_cols": ["Q", "Question", "Marks", "CO", "BL"], "questions": [
        {"label": "1", "marks": 2, "co": "CO1", "bl": 1, "difficulty": "easy"},
        {"label": "2", "marks": 2, "co": "CO1", "bl": 2, "difficulty": "easy"},
        {"label": "3", "marks": 4, "co": "CO2", "bl": 3, "difficulty": "medium", "type": "numerical"},
        {"label": "4", "marks": 6, "co": "CO2", "bl": 4, "difficulty": "medium", "type": "derivation"},
        {"label": "5", "marks": 6, "co": "CO3", "bl": 6, "difficulty": "hard"}]},
}

MULTIPAGE = {
    "name": "multipage", "subject": "control",
    "pages": [
        [{"t": "End-term Practice in Control Systems", "c": True},
         "Max. Marks: 50",
         {"gap": 8},
         "1. Define the transfer function of a linear time-invariant system. [5]",
         {"gap": 40},
         "2. State two advantages of a closed-loop system over an open-loop one. [5]",
         {"gap": 40},
         "3. Explain the effect of negative feedback on the gain of a system. [5]",
         {"gap": 500},
         "4. Find the poles of the system with characteristic equation s^2 + 4s + 8 = 0",
         "and comment on the stability"],
        ["of the closed-loop system, then sketch its root locus. [10]",
         {"gap": 30},
         "5. Determine the steady-state error of a type 1 system for a unit ramp input. [5]",
         {"gap": 30},
         "6. List the time-domain specifications of a second-order system. [5]"],
        ["7. Describe the construction of a Bode plot for a lead network. [5]",
         {"gap": 30},
         "8. Derive the expression for the peak overshoot of a second-order system. [10]"],
    ],
    "expect": {"total": 50, "runs_on": "4", "questions": [
        {"label": "1", "marks": 5, "page": 1}, {"label": "2", "marks": 5, "page": 1}, {"label": "3", "marks": 5, "page": 1},
        {"label": "4", "marks": 10, "page": 1, "type": "numerical"}, {"label": "5", "marks": 5, "page": 2},
        {"label": "6", "marks": 5, "page": 2}, {"label": "7", "marks": 5, "page": 3}, {"label": "8", "marks": 10, "page": 3}]},
}

OR_PAIRS = {
    "name": "or_pairs", "subject": "digital",
    "pages": [[
        {"t": "Practice Paper in Digital Logic", "c": True},
        "Max. Marks: 30",
        {"gap": 8},
        "1. Simplify the expression AB + AB' + A'B with a Karnaugh map. [5]",
        {"t": "OR", "c": True},
        "2. Implement a full adder using two half adders and an OR gate. [5]",
        {"gap": 10},
        "3. Explain the working of a JK flip-flop with its truth table. [10]",
        {"t": "OR", "c": True},
        "4. Design a mod-6 counter using T flip-flops. [10]",
        {"gap": 10},
        "5. Convert the decimal number 45 to binary and to hexadecimal. [5]",
        {"t": "OR", "c": True},
        "6. Compare TTL and CMOS logic families on any three points. [5]",
    ]],
    "expect": {"total": 30, "or_groups": [["1", "2"], ["3", "4"], ["5", "6"]], "questions": [
        {"label": "1", "marks": 5}, {"label": "2", "marks": 5}, {"label": "3", "marks": 10},
        {"label": "4", "marks": 10}, {"label": "5", "marks": 5}, {"label": "6", "marks": 5}]},
}

SUBPARTS = {
    "name": "subparts", "subject": "machines",
    "pages": [[
        {"t": "Assignment Test in Electrical Machines", "c": True},
        "Max. Marks: 30",
        {"gap": 8},
        "1 (a) Define the slip of an induction motor. [2]",
        {"t": "(b) Find the slip when the rotor turns at 1440 rpm on a 50 Hz four-pole supply. [3]", "x": 90},
        {"gap": 6},
        "2. Explain the construction of the core of a transformer.",
        {"t": "(a) State why the core is built of thin laminations. [2]", "x": 90},
        {"t": "(b) Derive the emf equation of a single-phase transformer. [6]", "x": 90},
        {"gap": 6},
        "3. Calculate the efficiency of a 10 kVA transformer at full load and unity power factor. [7]",
        {"gap": 6},
        "4. (i) List two losses that occur in a dc machine. [2]",
        {"t": "(ii) Explain how each of those losses can be reduced in practice. [8]", "x": 90},
    ]],
    "expect": {"total": 30, "questions": [
        {"label": "1", "marks": 5, "parts": ["a", "b"]}, {"label": "2", "marks": 8, "parts": ["a", "b"]},
        {"label": "3", "marks": 7, "parts": [], "type": "numerical"}, {"label": "4", "marks": 10, "parts": ["i", "ii"]}]},
}

SCANNED_PAGE = {
    "name": "scanned_page", "subject": "measurements",
    "pages": [
        [{"t": "Unit Test in Measurements", "c": True},
         "Max. Marks: 20",
         {"gap": 8},
         "1. Define the accuracy and the precision of an instrument. [5]",
         "2. Explain the working of a permanent magnet moving coil meter. [5]"],
        {"image": ["3. Describe the construction of a Wheatstone bridge and its use. [5]"]},
        ["4. State the sources of error in a digital voltmeter. [5]"],
    ],
    "expect": {"total": 20, "faults": ["p. 2: no text layer; OCR arrives in EW8"], "questions": [
        {"label": "1", "marks": 5, "page": 1}, {"label": "2", "marks": 5, "page": 1}, {"label": "4", "marks": 5, "page": 3}]},
}

SLIDES_PDF = {
    "name": "slides_pdf", "subject": "signals", "landscape": True,
    "pages": [
        [{"t": "Fourier Transform", "size": 24}, {"gap": 10},
         {"t": "- The transform pair links time and frequency", "size": 14},
         {"t": "- Linearity, time shift and scaling hold", "size": 14}],
        [{"t": "Sampling", "size": 24}, {"gap": 10},
         {"t": "- A band-limited signal is fixed by its samples", "size": 14},
         {"t": "- Aliasing appears below the Nyquist rate", "size": 14}],
        [{"t": "Laplace Transform", "size": 24}, {"gap": 10},
         {"t": "- The region of convergence decides causality", "size": 14},
         {"t": "- Poles in the left half plane mean a stable system", "size": 14}],
        [{"t": "Z Transform", "size": 24}, {"gap": 10},
         {"t": "- The discrete counterpart of the Laplace transform", "size": 14},
         {"t": "- The unit circle plays the part of the imaginary axis", "size": 14}],
    ],
    "expect": {"slides": ["Fourier Transform", "Sampling", "Laplace Transform", "Z Transform"], "questions": [
        {"label": "Fourier Transform", "marks": None}, {"label": "Sampling", "marks": None},
        {"label": "Laplace Transform", "marks": None}, {"label": "Z Transform", "marks": None}]},
}

MARKS_FORMS = {
    "name": "marks_forms", "subject": "networks",
    "pages": [[
        {"t": "Class Test in Network Analysis", "c": True},
        "Total Marks: 20",
        {"gap": 8},
        "Q.1 Define a tree of a connected graph. 2 M",
        "Q 2 State the superposition theorem for linear networks. 3M",
        "(3) Find the power in a 4 ohm load fed by a 2 A current source.      (5)",
        {"t": "4. Determine the resonant frequency of a series RLC circuit", "r": "5"},
        "with an inductance of 1 mH and a capacitance of 1 uF.",
        "5. Explain the maximum power transfer theorem",
        {"t": "for a purely resistive load.", "r": "5"},
        "6. Draw the dual of a given planar network and explain each step.",
    ]],
    "expect": {"total": 20, "questions": [
        {"label": "1", "marks": 2}, {"label": "2", "marks": 3}, {"label": "3", "marks": 5, "type": "numerical"},
        {"label": "4", "marks": 5, "type": "numerical"}, {"label": "5", "marks": 5}, {"label": "6", "marks": None}]},
}

TYPES_MCQ = {
    "name": "types_mcq", "subject": "communication",
    "pages": [[
        {"t": "Quiz in Analog Communication", "c": True},
        "Max. Marks: 12",
        {"gap": 8},
        "1. Which kind of modulation varies the amplitude of the carrier? [1]",
        {"t": "(a) AM", "x": 90}, {"t": "(b) FM", "x": 90}, {"t": "(c) PM", "x": 90}, {"t": "(d) PWM", "x": 90},
        "2. Define the modulation index of an AM wave. [1]",
        "3. Prove that the total power of an AM wave is Pc (1 + m^2/2). [4]",
        "4. Calculate the bandwidth of an FM wave with 75 kHz deviation and a 15 kHz tone. [3]",
        "5. Describe the block diagram of a superheterodyne receiver. [3]",
    ]],
    "expect": {"total": 12, "questions": [
        {"label": "1", "marks": 1, "type": "mcq", "parts": []}, {"label": "2", "marks": 1, "type": "short"},
        {"label": "3", "marks": 4, "type": "derivation"}, {"label": "4", "marks": 3, "type": "numerical"},
        {"label": "5", "marks": 3, "type": "descriptive"}]},
}

PAPERS = [SIGNALS_BASIC, CIRCUITS_SECTIONS, TABLE_PAPER, MULTIPAGE, OR_PAIRS, SUBPARTS, SCANNED_PAGE,
          SLIDES_PDF, MARKS_FORMS, TYPES_MCQ]
BY_NAME = {p["name"]: p for p in PAPERS}


def long_paper(n_pages: int = 20, per_page: int = 5) -> dict:
    """An invented paper of n_pages for the time and memory measurement (acceptance 9)."""
    pages, k = [], 0
    for p in range(n_pages):
        lines = ([{"t": "Long Practice Paper in Signals", "c": True}, "Max. Marks: 500", {"gap": 8}] if p == 0 else [])
        for _ in range(per_page):
            k += 1
            lines += [f"{k}. Find the output of system {k} for a step input of {k} volts and sketch it", "for the first five seconds. [5]", {"gap": 40}]
        pages.append(lines)
    return {"name": f"long_{n_pages}", "subject": "signals", "pages": pages,
            "expect": {"total": 500, "questions": [{"label": str(i), "marks": 5} for i in range(1, k + 1)]}}


DECK = {
    "name": "deck", "subject": "signals",
    "slides": [
        {"title": "Convolution", "body": ["The output of an LTI system is the input convolved with h(t)", "Flip, shift, multiply, add"],
         "notes": "remember to mention the graphical method"},
        {"title": "Impulse Response", "body": ["h(t) is the response to a unit impulse", "It fixes the whole system"]},
        {"title": "Stability", "body": ["Bounded input gives bounded output", "The impulse response must be absolutely integrable"],
         "notes": "ask the class for an unstable example"},
    ],
}
