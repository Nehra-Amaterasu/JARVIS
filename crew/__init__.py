"""The crew: JARVIS's always-on staff.

The idea: find the jobs that recur most in my day (how often x how long each one takes)
and give each its own agent that does only that job, all the time, fast and well. JARVIS
is the butler. Before he answers he reads what his staff know, so he can say "Aankhen saw
you waving", "you've been at the desk 40 minutes" or "Ollama is down, that's why I went
silent" without working any of it out himself.

    board.py            the blackboard: each agent's latest state and a ring of events
    base.py             Agent: id, name, role, cadence, health, summary, data, context line
    manager.py          Crew: runs every agent at its cadence; the API's view and JARVIS's block
    agents/movement.py  how I move through Aankhen's Wi-Fi: zone, activity, waves, restlessness
    agents/ledger.py    what I ask JARVIS for, counted, and which jobs deserve an agent of their own
    agents/steward.py   JARVIS's own health: Ollama, Aankhen, his process, recent errors

The rules every agent keeps:
  1. No language model inside a loop. Agents are deterministic and cheap, so they can run
     all day on a laptop whose 6 GB GPU already holds the LLM and Whisper. JARVIS's model
     reads what they found; it never runs for them.
  2. Every agent says what it cannot see. One Wi-Fi link sees a body move, not fingers or
     posture; the ledger sees counts and timings, never what I said.
  3. Simulated data is never narrated as real. While Aankhen runs its simulator the
     movement watcher says so, and posts nothing about me.
"""
