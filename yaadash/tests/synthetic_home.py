"""A small, invented message history for the memory tests. Nothing here is real.

Every person, message, date and fact below was made up for these tests. The shape is
real: it is written out as an Instagram data export (the same zip layout, JSON fields
and latin-1 mojibake Instagram uses), so the store is built by the production ingest
(`yaadash_archive.main`, then `yaadash_people.build`) rather than by test code that
could drift from it.

Each conversation is planted to exercise one retrieval rule from DECISIONS
(2026-10-09, "Hybrid recall, and the bugs it took to get right"):
  - a precise answer that is one line inside a chat about something else
    (Dev, 24 Feb 2021: "finally i completed dark souls"), which only BM25 can see;
  - "complete" in the question vs "completed" in the message (stemming);
  - a friend's shorter message with the same words (Ishaan), which must lose to
    his own because the question is in the first person;
  - the same topic (a trek) with two people, so a name in the question must pick
    the thread (Riya vs Dev);
  - the same topic in two years (Tanvi's exams), so "2021" must pick the year;
  - a named person with nothing on the topic (Kabir), so the search must fall back
    to everyone (the biryani recipe in the hostel group);
  - a rare token joke ("Professor Pineapple") that embeddings blur;
  - and nothing at all about skydiving, Dubai or a fight, which recall must refuse.
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

OWNER = "Test Owner"                    # the account holder (excerpts call him "Aman")
ACCOUNT = "testacct"
EXPORT_NAME = f"instagram-{ACCOUNT}-2024-03-01-synthetic.zip"


def _t(y, mo, d, h=18, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


# A session: (start time, [(sender, message)]). Messages are one minute apart, and
# every session starts days after the last, so the archive's 3-hour session split
# keeps them apart. A message may be a dict for non-text kinds (call, share, system).
THREADS = [
    {
        "slug": "riyakapoor_1029384756", "title": "Riya Kapoor",
        "participants": [OWNER, "Riya Kapoor"],
        "sessions": [
            (_t(2020, 6, 1), [
                ("Riya Kapoor", "hey! you're in the robotics club too right?"),
                (OWNER, "yes, joined last week. you're the one who built the line follower"),
                ("Riya Kapoor", "haha yes, it still crashes into walls"),
                (OWNER, "mine doesn't even move yet"),
            ]),
            (_t(2021, 3, 12), [
                ("Riya Kapoor", "Triund trek pe chalein is weekend?"),
                (OWNER, "haan pakka, Bhagsu se start karenge morning mein"),
                ("Riya Kapoor", "Kareri lake bhi add kar de, ek din extra"),
                (OWNER, "tent aur sleeping bag main le aaunga"),
                ("Riya Kapoor", "snow hogi upar, jacket le aana"),
                (OWNER, "done, trek ki planning final"),
            ]),
            (_t(2022, 7, 18), [
                (OWNER, "Professor Pineapple ne aaj phir roll call teen baar kiya \U0001F602"),
                ("Riya Kapoor", "Professor Pineapple legend hai, attendance ka itna shauk"),
                (OWNER, "next class mein main pineapple le jaunga"),
                ("Riya Kapoor", "don't you dare, we'll both get detention"),
            ]),
            (_t(2022, 8, 1), [
                ({"sender": "Riya Kapoor", "call_duration": 1800}),
                ("Riya Kapoor", "thanks for the call, feeling better about the internship"),
                (OWNER, "you'll be great, they'd be lucky to have you"),
            ]),
            (_t(2024, 2, 10), [
                ("Riya Kapoor", "did you get the robotics club alumni invite?"),
                (OWNER, "yes, going for sure"),
                ({"sender": OWNER, "share": {"link": "https://example.invalid/reel/1"}}),
                ({"sender": "Riya Kapoor", "content": "Liked a message"}),
            ]),
        ],
    },
    {
        "slug": "devmalhotra_5647382910", "title": "Dev Malhotra",
        "participants": [OWNER, "Dev Malhotra"],
        "sessions": [
            (_t(2021, 2, 24, 14), [
                ("Dev Malhotra", "bro suggest some games for the holidays"),
                (OWNER, "hollow knight for sure, and celeste if you like platformers"),
                ("Dev Malhotra", "elden ring kaisa hai?"),
                (OWNER, "massive open world, takes months"),
                ("Dev Malhotra", "ok adding hollow knight to the list"),
                (OWNER, "btw yaar finally i completed dark souls today after six months"),
                ("Dev Malhotra", "legend"),
            ]),
            # More "trek" than Riya's chat: without the person filter, a question
            # about the trek with Riya would land here.
            (_t(2023, 6, 2), [
                ("Dev Malhotra", "Hampta pass trek next month, chalega?"),
                (OWNER, "dates bata, trek ke liye leave le lunga"),
                ("Dev Malhotra", "15 to 20 July, Manali se start, trek mein 4 din camping"),
                (OWNER, "perfect, trek ke liye shoes khareedne padenge"),
                ("Dev Malhotra", "trek pe rain jacket bhi le lena"),
            ]),
        ],
    },
    {
        "slug": "ishaanbose_9081726354", "title": "Ishaan Bose",
        "participants": [OWNER, "Ishaan Bose"],
        "sessions": [
            (_t(2021, 5, 3), [
                ("Ishaan Bose", "completed dark souls bro"),
                (OWNER, "nice, which ending?"),
                ("Ishaan Bose", "linked the fire"),
            ]),
            # His own short line with the same two words and no "completed": without
            # stemming it outranks the real answer (shorter message, same matches).
            (_t(2022, 4, 9), [
                (OWNER, "dark souls remastered sale pe hai"),
                ("Ishaan Bose", "le le, sirf 400 ka hai"),
            ]),
        ],
    },
    {
        "slug": "tanvirao_1122334455", "title": "Tanvi Rao",
        "participants": [OWNER, "Tanvi Rao"],
        "sessions": [
            (_t(2021, 11, 20), [
                ("Tanvi Rao", "VLSI exam ka syllabus bhej de please"),
                (OWNER, "CMOS inverter, setup and hold time, and static timing analysis"),
                ("Tanvi Rao", "setup hold samajh nahi aata yaar"),
                (OWNER, "kal library mein samjha dunga, exam se pehle"),
                # Instagram writes Hindi as mojibake; the ingest must undo it and romanise.
                ("Tanvi Rao", "ठीक है, कल मिलते हैं"),
            ]),
            (_t(2023, 5, 8), [
                ("Tanvi Rao", "signals and systems exam kal hai, fourier transform yaad nahi"),
                (OWNER, "convolution property dekh le, wahi aayega"),
                ("Tanvi Rao", "thanks, exam ke baad chai"),
            ]),
        ],
    },
    {
        # Two messages, in two sessions: he is a person (resolvable), but no window
        # holds two texts, so a search confined to his thread finds nothing.
        "slug": "kabirsethi_6655443322", "title": "Kabir Sethi",
        "participants": [OWNER, "Kabir Sethi"],
        "sessions": [
            (_t(2022, 1, 1), [("Kabir Sethi", "happy new year bro")]),
            (_t(2022, 9, 15), [(OWNER, "happy birthday bhai, have a great year")]),
        ],
    },
    {
        "slug": "hostelwingb_7788990011", "title": "Hostel Wing B",
        "participants": [OWNER, "Rohan Iyer", "Meera Joshi"],
        "sessions": [
            (_t(2022, 10, 2), [
                ("Rohan Iyer", "sunday ko biryani banate hain wing mein"),
                ("Meera Joshi", "recipe kiske paas hai?"),
                ("Rohan Iyer", "dum biryani: chawal 70 percent ubalo, kewra water aur kesar wala doodh daalo"),
                ("Rohan Iyer", "phir 20 minute dum pe, aata se dhakkan seal karna"),
                (OWNER, "main raita aur salad le aaunga"),
                ("Meera Joshi", "done, 1 baje sab common room mein"),
            ]),
        ],
    },
]

# Rows for the identity store (yaadash_v2's "memories" table). Sources follow the
# real ones: authored facts, his own long DMs, and the two sources that must never be
# retrieved as evidence (his dev-session logs and JARVIS's own past replies).
MEMORIES = [
    {"text": "His name is Test Owner.", "source": "authored:Who he is", "role": "fact"},
    {"text": "He studies electronics and communication engineering.",
     "source": "authored:Who he is", "role": "fact"},
    {"text": "I have been baking sourdough bread every weekend, the starter is finally bubbly and the crust cracks",
     "source": "instagram:dm:Riya Kapoor", "role": "instagram_dm"},
    {"text": "Started learning the tabla this month, my teacher says my teentaal is finally steady",
     "source": "instagram:dm:Dev Malhotra", "role": "instagram_dm"},
    {"text": "I bake sourdough bread on weekends; push the bread timer script to git and fix the folders",
     "source": "claude:session", "role": "note"},
    {"text": "User: what bread do I bake on weekends?\nJARVIS: You bake sourdough bread every weekend.",
     "source": "voice_interaction", "role": "interaction"},
]


def _mojibake(s: str) -> str:
    """Instagram's encoding bug, reproduced: UTF-8 bytes written as latin-1 code points."""
    return s.encode("utf-8").decode("latin-1")


def _message(sender_or_dict, text, ts: datetime) -> dict:
    ms = int(ts.timestamp() * 1000)
    if isinstance(sender_or_dict, dict):
        m = dict(sender_or_dict)
        m["sender_name"] = _mojibake(m.pop("sender"))
        if "content" in m:
            m["content"] = _mojibake(m["content"])
        m["timestamp_ms"] = ms
        return m
    return {"sender_name": _mojibake(sender_or_dict), "timestamp_ms": ms,
            "content": _mojibake(text)}


def write_export(folder: Path) -> Path:
    """Write the synthetic export zip into `folder`; returns its path."""
    path = Path(folder) / EXPORT_NAME
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for th in THREADS:
            msgs = []
            for start, lines in th["sessions"]:
                for i, line in enumerate(lines):
                    ts = start + timedelta(minutes=i)
                    msgs.append(_message(line, None, ts) if isinstance(line, dict)
                                else _message(line[0], line[1], ts))
            msgs.sort(key=lambda m: -m["timestamp_ms"])          # Instagram: newest first
            doc = {"participants": [{"name": _mojibake(p)} for p in th["participants"]],
                   "messages": msgs, "title": _mojibake(th["title"])}
            z.writestr(f"your_instagram_activity/messages/inbox/{th['slug']}/message_1.json",
                       json.dumps(doc, ensure_ascii=True))
    return path


def thread_id(title: str) -> str:
    """The archive's thread id for a conversation title above."""
    th = next(t for t in THREADS if t["title"] == title)
    return f"{ACCOUNT}/{th['slug']}"
