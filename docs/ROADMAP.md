# JARVIS roadmap

Updated 2026-10-26. What works today, with its numbers, is in the [README](../README.md);
why each thing was built is in [DECISIONS.md](DECISIONS.md). The first version of this
roadmap (2026-10-12, a build list from an audit) is in this file's git history.

**Rules for every item:**
- "Done" means measured on the real hardware, with a test.
- Simulated results say *simulation*.
- Personal data stays in `data/`.
- No camera, ever.
- Nothing is claimed that a tool or a board did not confirm.

## Now
**Aankhen learns from real days.**
- The recording tools exist:
  - the drill;
  - `narrate`, which turns a narrated routine into labels using sync chirps and Whisper word timestamps;
  - a kNN fingerprint and a small CNN (about 19k weights), scored only on days they never saw.
- What's missing is the data: several days of labelled recordings, taken with the board in its final position.
- Gates:
  - in-room accuracy ≥ 95 % on every held-out day;
  - zone accuracy > 73 % by day 7, or add a second Wi-Fi link before more modelling.

**Well Wisher as the daily driver.** All eight engines are built. Next: exam-season use (internals contracts, backlog plan), one-tap logging, and a daily voice brief.

## Next
- **Relays without the USB cable:** a relay box on its own ESP32 (signed UDP or ESP-NOW), so the sensing board can sit where the Wi-Fi link crosses the room.
- **Live belief from the winner model:** once the CNN or kNN beats boosting on held-out days, it drives the zones. Later, int8 on the ESP32-S3.
- **"Lights follow me":** log-only for 7 days; then switching only at ≥ 95 % in-room accuracy on every tested day.
- **Voice:** "Jarvis, stop" during speech needs echo cancellation or a keyword spotter during playback.
- **Memory:** importers for my own data exports (local only); archive recall (3 of 10 today).

## Later
- Phone access from outside the home over Tailscale.
- JARVIS as an agent on the laptop (apps, files read-only), behind allowlists and a spoken yes.
- One ESP32 link per room for the whole home, with the household's consent.
- An Aankhen dataset and preprint, which needs 14+ labelled days.
