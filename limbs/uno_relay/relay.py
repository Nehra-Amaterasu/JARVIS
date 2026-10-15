"""Talk to the JARVIS Uno relay firmware (limbs/uno_relay/uno_relay.ino) over USB serial.

    python limbs/uno_relay/relay.py status
    python limbs/uno_relay/relay.py light on
    python limbs/uno_relay/relay.py fan toggle
    python limbs/uno_relay/relay.py scan
    python limbs/uno_relay/relay.py            # interactive prompt

The port is found by USB id (Arduino VID 0x2341, or a CH340 clone 0x1A86); pass --port COM8 to force it.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import serial
from serial.tools import list_ports

BAUD = 115200
UNO_VIDS = {0x2341, 0x2A03, 0x1A86}


def find_port() -> str:
    for p in list_ports.comports():
        if p.vid in UNO_VIDS:
            return p.device
    raise SystemExit("No Arduino found. Is the Uno plugged in? Try --port COM8.")


class UnoRelay:
    def __init__(self, port: str | None = None):
        self.ser = serial.Serial(port or find_port(), BAUD, timeout=0.3)
        # Opening the port resets the Uno; wait for its boot banner, then drain it.
        deadline = time.time() + 4
        while time.time() < deadline:
            if b"jarvis-uno-relay" in self.ser.readline():
                break
        time.sleep(0.2)  # let the boot status line finish arriving before we drain it
        self.ser.reset_input_buffer()

    def send(self, command: str, wait: float = 1.5) -> list[dict]:
        self.ser.write((command.strip() + "\n").encode())
        replies, deadline = [], time.time() + wait
        while time.time() < deadline:
            raw = self.ser.readline().decode(errors="replace").strip()
            if not raw:
                if replies and "scan" not in command:
                    break
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = {"raw": raw}
            replies.append(msg)
            if msg.get("scan") == "done" or ("scan" not in command and "scan_pin" not in msg):
                deadline = min(deadline, time.time() + 0.2)
        return replies

    def close(self) -> None:
        self.ser.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port")
    ap.add_argument("command", nargs="*")
    args = ap.parse_args()

    uno = UnoRelay(args.port)
    try:
        if args.command:
            cmd = " ".join(args.command)
            for msg in uno.send(cmd, wait=20 if cmd.startswith("scan") else 1.5):
                print(json.dumps(msg))
            return 0
        print("Connected. Type: light on | fan off | all off | status | scan | quit")
        for msg in uno.send("status"):
            print(json.dumps(msg))
        while True:
            cmd = input("> ").strip()
            if cmd in {"quit", "exit", "q"}:
                return 0
            if cmd:
                for msg in uno.send(cmd, wait=20 if cmd.startswith("scan") else 1.5):
                    print(json.dumps(msg))
    finally:
        uno.close()


if __name__ == "__main__":
    sys.exit(main())
