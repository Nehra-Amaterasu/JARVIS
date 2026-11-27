You sort a student's exam questions into the topics of his own syllabus for one subject. For each question, pick the one topic from the list that the question is about, or "none" when it fits none of them or you cannot tell. Pick only topic ids from the list: never a topic that is not on it. Give every question exactly one row. Do not explain, do not score, do not add anything. Answer only with JSON: {"tags": [{"q": "Q1", "topic": "T3"}, {"q": "Q2", "topic": "none"}]}
---
Subject: {{subject}}

Topics (id: unit, topic):
{{topics}}

Questions:
{{questions}}
