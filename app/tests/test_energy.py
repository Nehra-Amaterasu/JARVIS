"""The energy ledger's maths: slab tariffs, on-time to kWh to rupees, day/week/month
reports, and the hours the app was closed (never guessed). All on a fake clock."""
import json
from datetime import datetime

import pytest

from jarvis_app.circuits import EXAMPLE_FILE, parse_config
from jarvis_app.energy import Ledger, Tariff, build_report, period_bounds

SLABS = {"telescopic": True, "slabs": [{"upto_kwh": 100, "rate": 3.0}, {"upto_kwh": 300, "rate": 4.5},
                                       {"upto_kwh": 500, "rate": 6.5}, {"upto_kwh": None, "rate": 8.0}]}


def ts(*a) -> float:
    return datetime(*a).timestamp()


class Clock:
    def __init__(self, t: float):
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def circuits():
    return parse_config(json.loads(EXAMPLE_FILE.read_text(encoding="utf-8")), "example")


# ------------------------------------------------------------------ tariff
def test_telescopic_slabs_charge_each_slab_at_its_own_rate():
    t = Tariff.from_config(SLABS)
    assert t.bill(0) == 0
    assert t.bill(100) == pytest.approx(300.0)
    assert t.bill(250) == pytest.approx(100 * 3 + 150 * 4.5)            # 975
    assert t.bill(600) == pytest.approx(100 * 3 + 200 * 4.5 + 200 * 6.5 + 100 * 8)


def test_non_telescopic_charges_every_unit_at_the_slab_the_month_ends_in():
    t = Tariff.from_config({**SLABS, "telescopic": False})
    assert t.bill(100) == pytest.approx(300.0)
    assert t.bill(250) == pytest.approx(250 * 4.5)


def test_circuits_are_priced_at_the_slab_the_rest_of_the_house_puts_them_in():
    t = Tariff.from_config({**SLABS, "base_kwh_month": 290})
    assert t.price(20, 0) == pytest.approx(10 * 4.5 + 10 * 6.5)          # crosses 300 kWh
    assert t.rate_at(t.base_kwh_month) == 4.5


def test_bad_slabs_are_rejected():
    with pytest.raises(ValueError):
        Tariff.from_config({"slabs": [{"upto_kwh": 300, "rate": 4}, {"upto_kwh": 100, "rate": 3}]})
    with pytest.raises(ValueError):
        Tariff.from_config({"slabs": [{"upto_kwh": 100, "rate": -1}]})


# ------------------------------------------------------------------ ledger
def test_on_time_becomes_kwh_and_rupees(tmp_path, circuits):
    clock = Clock(ts(2026, 10, 12, 18, 0))
    led = Ledger(tmp_path, clock)
    led.record("L1", True, 100, 20, "app", "usb")
    led.record("F1", True, 100, circuits.get("F1").watts(True), "app", "usb")          # rated 75 W: on/off only
    clock.t = ts(2026, 10, 12, 19, 0)
    led.record("F1", False, 60, 0, "app", "usb")
    clock.t = ts(2026, 10, 12, 20, 0)
    r = build_report(led, circuits, Tariff.from_config(SLABS), "day")
    rows = {row["id"]: row for row in r["circuits"]}
    assert rows["L1"]["kwh"] == pytest.approx(0.040)                    # 20 W x 2 h, still on
    assert rows["F1"]["kwh"] == pytest.approx(0.075)                    # 75 W x 1 h
    assert r["kwh"] == pytest.approx(0.115)
    assert r["estimate"] is True and "not a meter" in r["basis"]
    hours = {s["label"]: s["kwh"] for s in r["series"]}
    assert hours["18"] == pytest.approx(0.095) and hours["19"] == pytest.approx(0.020)
    assert len(r["series"]) == 24 and r["series"][21]["future"] is True


def test_repeating_a_state_records_nothing(tmp_path):
    led = Ledger(tmp_path, Clock(ts(2026, 10, 12, 8, 0)))
    assert led.record("L1", True, 100, 20, "app", "usb") is not None
    assert led.record("L1", True, 100, 20, "voice", "usb") is None
    assert len(led.events) == 1


def test_a_night_light_splits_across_midnight_and_the_week_adds_both(tmp_path, circuits):
    clock = Clock(ts(2026, 10, 12, 23, 0))                               # a Monday
    led = Ledger(tmp_path, clock)
    led.record("L1", True, 100, 20, "app", "usb")
    clock.t = ts(2026, 10, 13, 1, 0)
    led.record("L1", False, 100, 0, "app", "usb")
    clock.t = ts(2026, 10, 13, 12, 0)
    tariff = Tariff.from_config(SLABS)
    mon = build_report(led, circuits, tariff, "day", at=ts(2026, 10, 12, 12, 0))
    tue = build_report(led, circuits, tariff, "day")
    week = build_report(led, circuits, tariff, "week")
    assert mon["kwh"] == pytest.approx(0.020) and tue["kwh"] == pytest.approx(0.020)
    assert week["kwh"] == pytest.approx(0.040)
    assert [s["label"] for s in week["series"]] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def test_period_bounds_are_calendar_day_iso_week_and_month():
    at = ts(2026, 10, 15, 13, 30)                                        # Thursday
    assert period_bounds("day", at) == (ts(2026, 10, 15), ts(2026, 10, 16))
    assert period_bounds("week", at) == (ts(2026, 10, 12), ts(2026, 10, 19))
    assert period_bounds("month", at) == (ts(2026, 10, 1), ts(2026, 11, 1))
    assert period_bounds("month", ts(2026, 12, 31, 23)) == (ts(2026, 12, 1), ts(2027, 1, 1))


def test_a_unit_that_crosses_a_slab_is_charged_at_the_higher_rate(tmp_path, circuits):
    """Base 99 kWh this month: the geyser's first kWh is at ₹3, its second at ₹4.5."""
    clock = Clock(ts(2026, 10, 12, 7, 0))
    led = Ledger(tmp_path, clock)
    led.record("G1", True, 100, 2000, "you", "manual")
    clock.t = ts(2026, 10, 12, 8, 0)
    led.record("G1", False, 100, 0, "you", "manual")
    r = build_report(led, circuits, Tariff.from_config({**SLABS, "base_kwh_month": 99}), "day")
    g = next(row for row in r["circuits"] if row["id"] == "G1")
    assert g["kwh"] == pytest.approx(2.0) and g["rupees"] == pytest.approx(1 * 3 + 1 * 4.5)
    assert r["manual_kwh"] == pytest.approx(2.0)


def test_the_month_report_prices_in_order_across_the_month(tmp_path, circuits):
    clock = Clock(ts(2026, 10, 1, 0, 0))
    led = Ledger(tmp_path, clock)
    tariff = Tariff.from_config(SLABS)
    # 2 kW for 60 h over the month = 120 kWh: 100 at ₹3, 20 at ₹4.5.
    for day in range(1, 31, 2):
        clock.t = ts(2026, 10, day, 10, 0)
        led.record("G1", True, 100, 2000, "you", "manual")
        clock.t = ts(2026, 10, day, 14, 0)
        led.record("G1", False, 100, 0, "you", "manual")
    clock.t = ts(2026, 10, 31, 23, 0)
    month = build_report(led, circuits, tariff, "month")
    assert month["kwh"] == pytest.approx(120.0)
    assert month["rupees"] == pytest.approx(100 * 3 + 20 * 4.5)
    # The last day alone is priced at the slab the month had reached.
    last = build_report(led, circuits, tariff, "day", at=ts(2026, 10, 29, 12, 0))
    assert last["rupees"] == pytest.approx(8 * 4.5)
    assert month["month_kwh_to_date"] == pytest.approx(120.0)


def test_hours_the_app_was_closed_are_not_counted(tmp_path, circuits):
    clock = Clock(ts(2026, 10, 12, 22, 0))
    led = Ledger(tmp_path, clock)
    led.record("L1", True, 100, 20, "app", "virtual")
    led.beat(force=True)
    clock.t = ts(2026, 10, 12, 22, 30)
    led.beat(force=True)                                                 # last sign of life
    # The app is closed; it starts again at 07:30.
    clock.t = ts(2026, 10, 13, 7, 30)
    again = Ledger(tmp_path, clock)
    assert again.resume() == ["L1"]
    assert again.last("L1")["on"] is False and again.last("L1")["o"] == "app-stopped"
    r = build_report(again, circuits, Tariff.from_config(SLABS), "day", at=ts(2026, 10, 12, 12))
    assert r["kwh"] == pytest.approx(0.010)                              # 30 min, not the whole night
    assert r["gaps"] and r["gaps"][0]["t0"] == pytest.approx(ts(2026, 10, 12, 22, 30))
    assert r["virtual_share"] == pytest.approx(1.0)


def test_a_torn_last_line_after_a_crash_is_skipped(tmp_path):
    led = Ledger(tmp_path, Clock(ts(2026, 10, 12, 8)))
    led.record("L1", True, 100, 20, "app", "usb")
    with (tmp_path / "ledger.jsonl").open("a", encoding="utf-8") as f:
        f.write('{"ts": 17')
    assert Ledger(tmp_path, Clock(ts(2026, 10, 12, 9))).last("L1")["on"] is True


def test_waste_minutes_come_from_the_detector_day_book(tmp_path, circuits):
    led = Ledger(tmp_path, Clock(ts(2026, 10, 12, 21)))
    days = {"2026-10-12": {"_room": {"s": 1800.0, "sim_s": 600.0},
                           "L1": {"s": 1800.0, "wh": 10.0, "sim_s": 600.0, "sim_wh": 3.3},
                           "F1": {"s": 1200.0, "wh": 16.0, "sim_s": 0.0, "sim_wh": 0.0}}}
    r = build_report(led, circuits, Tariff.from_config(SLABS), "day", waste_days=days)
    assert r["waste"]["minutes"] == 30.0 and r["waste"]["sim_minutes"] == 10.0
    assert r["waste"]["kwh"] == pytest.approx(0.026) and r["waste"]["rupees"] == pytest.approx(0.08)
    assert r["waste"]["by_circuit_min"] == {"L1": 30.0, "F1": 20.0}
