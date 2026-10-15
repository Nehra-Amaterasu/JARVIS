# The Aankhen drill: how to teach the sensor your room

This is the daily routine that teaches the ESP32 where you are and what you are doing. It replaces "learn my room". It takes about 26 minutes a day.

## Why a drill, and why every day

The old models learned 5 minutes of one evening. Anything they had not seen came out as "bed" or "waving". Wi-Fi changes from day to day: firmware, the fan, furniture, even the weather. A model only gets good if it has seen many different days.

So the rules are:
- one drill a day, at different times of day;
- a score that comes only from days the model never trained on.

Until a drill has run on the current firmware, Aankhen now says **"unsure"** instead of guessing.

## Before you start

- Start the JARVIS app and press **ESP32** on the Aankhen tab. The drill records through the app and never fights it for the USB port.
  - If the app is not running, the drill opens the board itself.
- The room should look the way it normally does. Close the bathroom and balcony doors unless a block asks you to use them.
- Use the same firmware all week. A day on new firmware counts as a new kind of day.

## Running it

```
python -m aankhen drill                 # the default: ~26 min, fan off and fan on
python -m aankhen drill --plan          # just show today's blocks
python -m aankhen drill --minutes 15    # shorter
python -m aankhen drill --fan on        # only fan-on blocks
python -m aankhen drill --zones at_desk_chair,bed_lying   # only these places
python -m aankhen drill --no-voice      # print and beep instead of speaking
```

Run these from the JARVIS folder with the project venv.

## What happens in each block

1. JARVIS says the block, for example: "Next: lie on the bed, still. Fan off."
2. Go there. Press **Enter** when you are in place.
3. "Starting in 5… go." Hold that position or activity until JARVIS says **"Done."** (50 seconds).
4. Answer:

| Key | Meaning |
|---|---|
| Enter | yes, I did it as asked |
| `r` | redo it |
| `b` | bad, throw it away |
| `w bed_sitting` | I was really somewhere else; give the zone, and optionally the activity, e.g. `w bed_sitting still` |
| `q` | stop the drill |

**The label is what you confirm, not what was asked.** If you ended up sitting instead of lying, say so with `w`. That data is still good.

### The two empty-room blocks

One is with the fan off and one with the fan on.
1. Press Enter, then **leave the room and close the door** within 15 seconds.
2. JARVIS records the empty room for 2 minutes.
3. Come back when you hear the chime.

These blocks also give Aankhen today's empty-room reference, so they matter more than any other block.

### The fan

The drill switches the fan through the relay board and waits 30 s for it to settle. If the relay board does not answer, JARVIS asks you to switch it by hand.

### When a block fails its checks

A block fails if:
- the Wi-Fi was too slow;
- there were too many gaps in the data;
- the signal was very different from the empty room;
- a typing block had no typing;
- a still block had key presses.

A failed block repeats **once** at the end. Only the number of key presses is counted, never which keys.

## The places (zones)

| Zone | What it means |
|---|---|
| at_desk_chair | sitting on the desk chair |
| desk_standing | standing at the desk |
| beside_bed_desk_side | moving beside the bed, in front of the desk |
| bed_lying | lying on the bed |
| bed_sitting | sitting on the bed |
| standing_on_bed | standing on the bed |
| beside_bed_bathroom_wall | beside the bed, along the bathroom wall |
| outside_bathroom | just outside the bathroom door |
| inside_bathroom | in the bathroom, door closed |
| between_bed_and_balcony_door | moving in front of the bed, toward the balcony door |
| at_balcony_door | at the balcony door |
| balcony | out on the balcony, door closed |
| room_door | at the room door, inside |
| wardrobe | at the wardrobe |
| out_of_room | gone |

Activities are separate: **still, typing, moving, lying, none**. "Waving" is gone.

The zone positions are estimates worked out from your room layout. To see them, run `python -m aankhen zones`.

To correct them:
1. Run `python -m aankhen zones --write`.
2. Edit `data/aankhen/zones.json`. Positions are in metres in the room frame, each with a radius.
3. Set `"estimate": false` on each zone you measured.

## How many days, and when

| Days of drills | What you get |
|---|---|
| 1 | Today's empty-room reference. No score yet. |
| 2-3 | The first scores on a held-out day (`evaluate`). |
| 4 | A first real reading. |
| **7** | **The decision (the kill rule).** |
| 14 | The full target. |

- Leave at least 12 hours between drills.
- Rotate the time of day: morning, evening, and at least two nights. On a night drill, the bed blocks are your real sleeping position with the lights off.
- The order of the blocks changes every day, and so does whether fan-off or fan-on comes first. You don't plan anything.

## Reading the evaluator

```
python -m aankhen evaluate --leave-one-day-out
python -m aankhen train
```

`evaluate` trains on every day except one, tests on that one, and repeats for each day. For each held-out day it prints:

| Line | What it means |
|---|---|
| in-room | did it know you were in the room versus gone? |
| zone top-1 | was its first guess the right zone? (in-room time only) |
| zone top-3 | was the right zone among its first three guesses? |
| activity | still / typing / moving / lying / none |
| fan on / fan off | the same numbers, split by the fan |
| confusion | for each true zone, what it guessed and how often; it shows which places it mixes up |

Then come **the gates**:

| Gate | What PASS means | What FAIL means |
|---|---|---|
| in-room ≥ 95 % on every held-out day | presence is good enough to trust | not yet; keep drilling |
| zone top-1 > 73 % by day 7 (the kill rule) | Wi-Fi from one ESP32 really carries your position: keep improving it | the information is not in one link, and more drills won't help |

If the zone gate fails at day 7, the next step is hardware (a second ESP32 across the bed, or sonar), not more of the same. Before day 7 it says **NOT YET**.

`train` builds the models from every drill day and saves them as a new version; old versions are kept. The app uses the new one from its next Aankhen start.

## What Aankhen tells you meanwhile

The app and JARVIS now show:
- **in the room**, **empty** or **unsure**;
- a zone only when it is at least 60 % sure;
- an activity only when it is at least 70 % sure.

When it is unsure it says why. For example: "no empty-room reference for this firmware and fan yet".

Your laptop and phone also teach it, using counts only:
- typing in the last few seconds means you are at the desk;
- your phone gone from the Wi-Fi and the laptop idle for 10+ minutes means the room is empty.

The second one also refreshes the empty-room reference once a day. For it, add your phone's IP or MAC to `data/aankhen/teachers.json`:

```json
{"phone_ip": "192.168.1.23"}
```

## Privacy

- Keyboard and mouse: counts only, never keys or text.
- No audio is kept.
- Everything stays in `data/aankhen/`, which is never put in git.
