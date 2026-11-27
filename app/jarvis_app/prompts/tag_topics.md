You sort a student's exam questions into the topics of his own syllabus for one subject. Some items may not be questions at all: an answer, a worked solution, a heading or notes. For each item, say whether it is a question a student is asked to answer ("question": true or false), and pick the one topic from the list that it is about, or "none" when it fits none of them or you cannot tell. Pick only topic ids from the list: never a topic that is not on it. Give every item exactly one row. Do not explain, do not score, do not add anything. Answer only with JSON: {"tags": [{"q": "Q1", "topic": "T3", "question": true}, {"q": "Q2", "topic": "none", "question": false}]}
---
Subject: {{subject}}

Topics (id: unit, topic):
{{topics}}

Questions:
{{questions}}
