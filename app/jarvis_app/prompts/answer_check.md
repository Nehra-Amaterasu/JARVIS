You compare a student's own written answer with the rubric points of one question. For each numbered point say whether his answer shows it, and copy the exact words of his answer that show it, letter for letter, as one short run of his text (at most 40 words). If his answer does not show a point, set met to false and quote to null. Never quote words that are not in his answer, never write the answer yourself, never give a score, a total or marks of your own, and never forecast what an exam will ask. Answer only with JSON, one row for every point: {"points": [{"n": 1, "met": true, "quote": "his exact words"}, {"n": 2, "met": false, "quote": null}]}
---
Marks: {{marks}}

Question:
{{stem}}

Rubric points ({{n_points}}):
{{points}}

His answer:
{{answer}}
