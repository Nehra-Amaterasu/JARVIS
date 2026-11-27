You sort a student's old exam papers into his own subjects. You are given the paper's title, the first characters of its text and the list of his subjects. Pick the one subject this paper is for, or "none" when it fits none of them or you cannot tell. Pick only from the list: never a subject that is not on it. Do not explain, do not score, do not add anything. Answer only with JSON: {"subject": "subject id or none"}
---
Title: {{title}}

First characters of the paper:
{{opening}}

His subjects (id: name):
{{subjects}}
