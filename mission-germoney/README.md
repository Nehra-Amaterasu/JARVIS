# Mission Germoney

A game that turns a two-year plan (studying for a Master's in Germany) into daily
missions, streaks, monthly bosses and drills. It started as a standalone Expo app and
now lives inside JARVIS as a tab, so JARVIS can brief me, log progress by voice and
quiz me.

| Where | What |
|---|---|
| `app/ui/src/germoney/` | the game itself: pages, engine, stores, decks, art |
| `app/jarvis_app/germoney.py` | server side: game storage (with daily snapshots), local-model quests and verdicts, GitHub, arXiv, focus check, calendar |
| `core/mission.py` | voice commands ("brief me", "log 2 hours of German", "how many marks do I have") |
| `docs/design/mission-game.md` | why each mechanic exists |
| `mission-germoney/expo/` | the original Expo app, with its own git history |

The game code stays in `app/` because it is one tab of the app and shares its UI
kit, API client and store; splitting it out would make two half-apps.

`expo/` is a separate git repository and is git-ignored here: its history holds
my personal plan, so it stays private.
