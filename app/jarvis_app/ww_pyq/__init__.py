"""The question engine of Well Wisher (the "pyq" package): his own papers, notes and slide decks
become reviewed questions, counted patterns, a validated blueprint and a seeded practice paper.

    schema.py    the records every module shares (frozen per wave by the engine lane's integrator)
    api.py       the response envelope and the error mapping every pyq route file uses
    store.py     the private review-staging store with crops (E05)
    ingest.py    PDFs and slide decks to question drafts (E06)
    patterns.py  counts with their N, families, the practise-next list (E07)
    generate.py  blueprint, generator around ww_generator, print set, numeric check (E08)

Everything it stores lives under the private data directory (paths.DATA / "pyq") and nothing
here uses the network. Plan and route contracts: docs/design/well-wisher-engine-plan.md, section 9.
"""
