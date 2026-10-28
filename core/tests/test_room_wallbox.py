"""The wall box by voice: six relays, group words, modes by name, and a brightness ladder.

The relays only switch; "brighter" steps along the lighting modes instead of lying about a
dimmer. Devices and modes come from the two example files the app ships for the box."""
import shutil
from pathlib import Path

import pytest

import room

APP = Path(__file__).resolve().parents[2] / "app" / "jarvis_app"


@pytest.fixture
def wallbox(tmp_path, monkeypatch):
    shutil.copy(APP / "devices.esp32-box.example.json", tmp_path / "devices.json")
    shutil.copy(APP / "modes.wallbox.example.json", tmp_path / "modes.json")
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))
    room.state = room._fresh_state()
    yield room
    room.state = room._fresh_state()


def test_the_box_has_six_devices(wallbox):
    assert [d["id"] for d in room._devices()] == ["light", "fan", "light2", "light3", "light4", "light5"]


@pytest.mark.parametrize("said, expected", [
    ("pink outer on", [("light4", "on", None)]),
    ("warm inner off", [("light3", "off", None)]),
    ("pink on", [("light4", "on", None), ("light5", "on", None)]),
    ("pink lights on", [("light4", "on", None), ("light5", "on", None)]),
    ("warm lights off", [("light2", "off", None), ("light3", "off", None)]),
    ("white lights on", [("light", "on", None)]),
    ("lights on", [("light", "on", None)]),
    ("lights on and pink on", [("light", "on", None), ("light4", "on", None), ("light5", "on", None)]),
    ("fan on", [("fan", "on", None)]),
    ("sab band karo", [("all", "off", None)]),
    ("everything off", [("all", "off", None)]),
])
def test_devices_and_groups_by_name(wallbox, said, expected):
    assert room.parse(said) == expected


@pytest.mark.parametrize("said, mode", [
    ("movie mode", "movie"), ("Jarvis, party", "party"), ("night light", "night_light"),
    ("set pink calm", "pink_calm"), ("festive mode on", "festive"), ("all lights", "all_lights"),
    ("deep focus", "focus"), ("wind down", "relaxation"),
])
def test_modes_by_their_names(wallbox, said, mode):
    assert room.parse(said) == [("environment", mode, mode)]


def test_brighter_climbs_the_ladder_from_dark(wallbox):
    assert room.parse("brighter") == [("environment", "night_light", "night_light")]
    room.apply("environment", "movie")
    assert room.parse("brighter") == [("environment", "relaxation", "relaxation")]
    room.apply("environment", "morning")
    assert room.parse("make it brighter") == [("environment", "all_lights", "all_lights")]
    room.apply("environment", "all_lights")
    assert room.parse("brighter") == [("environment", "all_lights", "all_lights")]   # the top stays the top


def test_dimmer_goes_down_and_ends_with_every_light_off(wallbox):
    room.apply("environment", "morning")
    assert room.parse("dimmer") == [("environment", "reading", "reading")]
    room.apply("environment", "night_light")
    assert room.parse("dimmer") == [(d, "off", None) for d in ("light", "light2", "light3", "light4", "light5")]


def test_a_named_device_still_gets_the_honest_level_answer(wallbox):
    assert room.parse("fan faster") == [("fan", "level", None)]
    assert room.parse("make the light brighter") == [("light", "level", None)]


def test_the_ladder_needs_the_box_modes(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVIS_DATA_DIR", str(tmp_path))      # the default room: light + fan, 4 modes
    room.state = room._fresh_state()
    try:
        assert room.parse("brighter") == []                   # no ladder, nothing invented
    finally:
        room.state = room._fresh_state()
