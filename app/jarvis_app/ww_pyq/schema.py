"""The records of the question engine, shared by every ww_pyq module and by the route contracts
R-01 onward (docs/design/well-wisher-engine-plan.md, section 9).

Frozen for a wave: a builder who needs a field that is not here stops and reports it; the lane's
integrator adds it here and logs the change in the plan file's "Changes" list, because the UI lane
derives its port types from these names. All TypedDicts are total=False on purpose: a record
written by an older wave must still load, and every reader uses .get with the stated default.

Why crop-first: a page crop cannot be mis-read, recognised text can. So a question always keeps
where it sits on the page (`crop`), and its text is a layer with a status of its own.
"""
from __future__ import annotations

from typing import Literal, Optional, TypedDict

SCHEMA_VERSION = 2          # 2 (14 Nov, EW8): Question.origin, source_question, ocr_confidence; Method gains nothing

# ---------------------------------------------------------------- honest states (plan file, rule 3)
State = Literal["live", "waiting", "simulated", "planned", "fault"]
STATES: tuple[str, ...] = ("live", "waiting", "simulated", "planned", "fault")

# ---------------------------------------------------------------- small vocabularies
TextStatus = Literal["verified", "unverified", "none"]        # text layer read; recognised, not confirmed; crop only
QStatus = Literal["pending", "accepted", "rejected"]
StatusBy = Literal["hand", "rule"]                            # a model never sets a status
TagSource = Literal["hand", "rule", "model", "none"]          # "model" is a proposal only and is never stored as accepted
MarksSource = Literal["printed", "table", "hand", "missing"]  # never guessed: a question with no printed marks stays in review
QType = Literal["numerical", "derivation", "short", "mcq", "descriptive", "slide", "unknown"]
Difficulty = Literal["easy", "medium", "hard", ""]
DifficultySource = Literal["rule", "bloom", "attempts", "hand", ""]
PaperKind = Literal["pdf", "pptx", "hand"]
Method = Literal["text-layer", "slides", "ocr", "mixed", "typed"]
ExamKind = Literal["cie", "end_sem", "backlog", "gate", "aptitude", "notes", "other"]
# A model draft is never "accepted" by the model: it becomes a question only when he accepts it, and keeps
# origin "model-draft" so every screen can say "drafted by the local model, accepted by you".
Origin = Literal["paper", "hand", "template", "model-draft", "harvest"]
ORIGINS: tuple[str, ...] = ("paper", "hand", "template", "model-draft", "harvest")

TEXT_STATUSES: tuple[str, ...] = ("verified", "unverified", "none")
Q_STATUSES: tuple[str, ...] = ("pending", "accepted", "rejected")
Q_TYPES: tuple[str, ...] = ("numerical", "derivation", "short", "mcq", "descriptive", "slide", "unknown")
EXAM_KINDS: tuple[str, ...] = ("cie", "end_sem", "backlog", "gate", "aptitude", "notes", "other")

MAX_TEXT = 2000            # the same ceiling as ww_bank_store.MAX_TEXT and a typed question
CROP_DPI = 150             # one render per page (spec 21.3.1 rule 2); a bbox stays in PDF points (72 per inch)
FLOOR_PAPERS = 3           # below it a pattern is "too few papers" (spec 20.7.9; an assumption to tune)
FLOOR_QUESTIONS = 20       # reviewed questions a subject needs before a pattern is drawn solid


class Crop(TypedDict, total=False):
    page: int                       # 1-based page or slide
    bbox: list[float]               # [x0, y0, x1, y1] in PDF points on that page
    png: str                        # path relative to the store root, forward slashes; "" when not rendered
    dpi: int


class Part(TypedDict, total=False):
    label: str                      # "a", "ii"
    text: str
    marks: Optional[float]


class PaperMeta(TypedDict, total=False):
    id: str                         # "p-" + first 12 hex of the file's SHA-256 ("p-hand-" + 8 hex for a typed paper)
    sha256: str
    filename: str                   # the name only, never a full path
    kind: PaperKind
    method: Method
    subject: str                    # a ww_bank_store.slug, "" until he maps it
    exam_kind: ExamKind
    year: Optional[int]
    title: str
    source_note: str                # where it came from, in his words, or "manual drop-in"
    pages: int
    total_marks: Optional[float]    # printed on the paper, when found
    added: str                      # ISO date-time, local
    faults: list[str]               # e.g. "p. 3: no text layer and no OCR engine"


class QuestionDraft(TypedDict, total=False):
    label: str                      # as printed: "3", "Q4", "2b"
    kind: Literal["question", "slide"]
    text: str                       # "" when text_status is "none"
    text_status: TextStatus
    crop: Optional[Crop]
    page: int
    marks: Optional[float]
    marks_source: MarksSource
    type: QType
    section: str                    # "A", "B"; "" when the paper has no sections
    choice_group: str               # questions sharing a non-empty value are an OR pair or an any-k set
    co: str                         # course-outcome chip from a table column, e.g. "CO3"; "" when absent
    bl: Optional[int]               # Bloom level 1..6 from a table column
    parts: list[Part]


class Question(QuestionDraft, total=False):
    id: str                         # "q-" + 12 hex, stable for the life of the paper
    paper_id: str
    status: QStatus
    status_by: StatusBy
    unit: Optional[int]
    topic: str
    tag_source: TagSource
    tag_score: Optional[float]      # cosine of the best topic, when a rule tagged it
    tag_margin: Optional[float]     # best minus second best
    difficulty: Difficulty
    difficulty_source: DifficultySource
    family_id: str                  # "" until families are computed or confirmed
    edited: bool                    # he changed the text or the marks by hand
    updated: str                    # ISO date-time of the last change
    # Added for EW8 (schema 2): where the question came from. "paper" is the default for every record
    # written before, so an old record reads as his own paper's question.
    origin: Origin
    source_question: str            # for a variant: the id of the question it was drafted from
    ocr_confidence: Optional[float]  # mean line confidence when the text came from OCR (text_status "unverified")


class Topic(TypedDict, total=False):
    unit: int
    topic: str
    key: str                        # ww_generator.topic_key(unit, topic)
    keywords: list[str]
    weight: Literal["high", "med", "low"]


class Coverage(TypedDict, total=False):
    subject: str
    papers: int
    questions: int
    pending: int
    accepted: int
    rejected: int
    tagged: int                     # accepted questions that carry a unit and a topic
    marks_missing: int
    floor_papers: int               # FLOOR_PAPERS
    floor_questions: int            # FLOOR_QUESTIONS
    floor_met: bool


class FolderState(TypedDict, total=False):
    path: Optional[str]             # None until he chooses a folder
    exists: bool
    files_seen: int
    pending_files: list[str]        # names only, not yet read (by file hash)
    last_scan: Optional[str]


class TraceEvent(TypedDict, total=False):
    t: float                        # seconds since the job started
    page: Optional[int]
    kind: str                       # "open", "page", "table", "segment", "crop", "skip", "fault", "done"
    text: str                       # one real event, e.g. "p1 table 5 cols: Q, text, marks, CO, BL"
