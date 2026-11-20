"""The window's frosted glass (backdrop.py, desktop.py): the off path is the window of
before, the on path asks for a transparent window and a system backdrop, and any DWM
failure falls back to the opaque ground. No window is opened: the Windows calls are a fake."""
import json
import subprocess
import sys

import pytest

from jarvis_app import backdrop, desktop

HWND = 0x1234


class FakeDwm:
    """Records every call; `fail` maps an attribute (or 'extend') to the HRESULT to return."""

    def __init__(self, fail=None, raises=None):
        self.calls = []
        self.fail = fail or {}
        self.raises = raises

    def set_attribute(self, hwnd, attribute, value):
        self.calls.append(("attr", hwnd, attribute, value))
        if self.raises and attribute == backdrop.DWMWA_SYSTEMBACKDROP_TYPE and value != backdrop.DWMSBT_NONE:
            raise self.raises
        undo = attribute == backdrop.DWMWA_SYSTEMBACKDROP_TYPE and value == backdrop.DWMSBT_NONE
        return 0 if undo else self.fail.get(attribute, 0)

    def extend_frame(self, hwnd, margin):
        self.calls.append(("extend", hwnd, margin))
        return self.fail.get("extend", 0)


# ------------------------------------------------------------ the window arguments

# The arguments create_window had before glass existed (desktop.py, 10-25 splash change).
BEFORE = {"width": 1440, "height": 900, "min_size": (1120, 720), "frameless": True,
          "easy_drag": False, "background_color": "#050506", "text_select": False}


def test_glass_off_builds_the_window_arguments_of_before():
    assert desktop.window_options(False) == BEFORE
    assert "transparent" not in desktop.window_options(False)


def test_glass_on_only_adds_a_transparent_window():
    on = desktop.window_options(True)
    assert on.pop("transparent") is True
    assert on == BEFORE


def test_the_default_window_api_is_glass_off():
    api = desktop.WindowApi()
    st = api.glass_state()
    assert st["on"] is False and st["restart_needed"] is False
    assert set(st) == {"on", "setting", "kind", "restart_needed", "reason"}


# ------------------------------------------------------------ the setting

def test_setting_defaults_to_off(tmp_path):
    p = tmp_path / "settings.json"
    assert backdrop.read_glass_setting(p) is False                # no file
    p.write_text("{not json", encoding="utf-8")
    assert backdrop.read_glass_setting(p) is False                # a broken file
    p.write_text(json.dumps({"window": {"glass": "yes"}}), encoding="utf-8")
    assert backdrop.read_glass_setting(p) is False                # only a real true counts
    p.write_text(json.dumps({"window": {"glass": True}}), encoding="utf-8")
    assert backdrop.read_glass_setting(p) is True


def test_writing_the_setting_keeps_the_rest_of_the_file(tmp_path):
    p = tmp_path / "settings.json"
    p.write_text(json.dumps({"voice": {"id": "x", "speed": 1.1}, "window": {"other": 1}}), encoding="utf-8")
    backdrop.write_glass_setting(p, True)
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["voice"] == {"id": "x", "speed": 1.1}
    assert data["window"] == {"other": 1, "glass": True}
    backdrop.write_glass_setting(p, False)
    assert backdrop.read_glass_setting(p) is False
    assert not list(tmp_path.glob("*.tmp"))                       # the swap leaves nothing behind


# ------------------------------------------------------------ applying the backdrop

def test_apply_asks_for_dark_mode_then_the_frame_then_the_backdrop():
    dwm = FakeDwm()
    res = backdrop.apply_backdrop(HWND, "acrylic", dwm, build=26300)
    assert res.active and res.kind == "acrylic" and res.reason is None
    assert dwm.calls == [("attr", HWND, 20, 1), ("extend", HWND, -1), ("attr", HWND, 38, 3)]


def test_mica_is_type_2_and_a_light_ground_can_ask_for_light_mode():
    dwm = FakeDwm()
    assert backdrop.apply_backdrop(HWND, "mica", dwm, 26300, dark=False).active
    assert dwm.calls[0] == ("attr", HWND, 20, 0) and dwm.calls[-1] == ("attr", HWND, 38, 2)


@pytest.mark.parametrize("fail", [{38: -2147024809}, {"extend": -2147467259}, {20: 1}])
def test_a_failing_dwm_call_falls_back_and_undoes_the_backdrop(fail, caplog):
    dwm = FakeDwm(fail=fail)
    res = backdrop.apply_backdrop(HWND, "acrylic", dwm, 26300)
    assert res.active is False and res.kind is None and "DWM refused" in res.reason
    assert dwm.calls[-1] == ("attr", HWND, 38, backdrop.DWMSBT_NONE)      # plain window again


def test_an_exception_in_dwm_falls_back_too():
    dwm = FakeDwm(raises=OSError("no dwmapi"))
    res = backdrop.apply_backdrop(HWND, "acrylic", dwm, 26300)
    assert res.active is False and "OSError" in res.reason


def test_a_windows_without_system_backdrops_never_calls_dwm():
    dwm = FakeDwm()
    res = backdrop.apply_backdrop(HWND, "acrylic", dwm, build=19045)       # Windows 10
    assert res.active is False and "19045" in res.reason
    assert dwm.calls == []


def test_an_unknown_kind_is_refused():
    assert backdrop.apply_backdrop(HWND, "tabbed", FakeDwm(), 26300).active is False


# ------------------------------------------------------------ the controller

def make_glass(tmp_path, requested, **kw):
    p = tmp_path / "settings.json"
    return backdrop.Glass(requested, p, dwm=kw.pop("dwm", FakeDwm()), build=kw.pop("build", 26300), **kw), p


def test_glass_off_never_touches_dwm_even_when_attached(tmp_path):
    g, _ = make_glass(tmp_path, False)
    st = g.attach(HWND)
    assert st["on"] is False and g._dwm.calls == []


def test_glass_on_reports_on_after_the_window_is_attached(tmp_path):
    g, _ = make_glass(tmp_path, True)
    assert g.state()["on"] is False                                # before the window exists: opaque
    st = g.attach(HWND)
    assert st["on"] is True and st["kind"] == "acrylic" and st["restart_needed"] is False


def test_a_failing_dwm_reports_off_and_logs_which(tmp_path, caplog):
    g, _ = make_glass(tmp_path, True, dwm=FakeDwm(fail={38: -2147024809}))
    with caplog.at_level("WARNING", logger="jarvis.backdrop"):
        st = g.attach(HWND)
    assert st["on"] is False and "DWM refused backdrop" in st["reason"]
    assert any("OFF, opaque ground" in r.message for r in caplog.records)


def test_old_windows_reports_off_with_the_build(tmp_path, caplog):
    g, _ = make_glass(tmp_path, True, build=19045)
    with caplog.at_level("WARNING", logger="jarvis.backdrop"):
        st = g.attach(HWND)
    assert st["on"] is False and "19045" in st["reason"]
    assert any("19045" in r.message for r in caplog.records)


def test_switching_off_live_clears_the_backdrop_and_stores_it(tmp_path):
    g, p = make_glass(tmp_path, True)
    g.attach(HWND)
    st = g.set(False)
    assert st["on"] is False and st["setting"] is False
    assert g._dwm.calls[-1] == ("attr", HWND, 38, backdrop.DWMSBT_NONE)
    assert backdrop.read_glass_setting(p) is False


def test_switching_on_a_window_made_opaque_asks_for_a_restart(tmp_path):
    g, p = make_glass(tmp_path, False)
    g.attach(HWND)
    st = g.set(True)
    assert st["on"] is False and st["restart_needed"] is True and st["setting"] is True
    assert g._dwm.calls == []                                      # nothing an opaque window could show
    assert backdrop.read_glass_setting(p) is True                  # the next start makes it transparent


def test_switching_on_again_in_a_transparent_window_works_live(tmp_path):
    g, _ = make_glass(tmp_path, True)
    g.attach(HWND)
    g.set(False)
    st = g.set(True, dark=False)
    assert st["on"] is True
    assert g._dwm.calls[-3] == ("attr", HWND, 20, 0)


def test_the_host_resetting_the_backdrop_is_reasserted(tmp_path):
    g, _ = make_glass(tmp_path, True)
    g.attach(HWND)
    n = len(g._dwm.calls)
    g.reassert()
    assert len(g._dwm.calls) == n + 3 and g._dwm.calls[-1] == ("attr", HWND, 38, backdrop.DWMSBT_ACRYLIC)


def test_reassert_does_nothing_when_glass_failed_or_is_off(tmp_path):
    g, _ = make_glass(tmp_path, True, dwm=FakeDwm(fail={38: 5}))
    g.attach(HWND)
    n = len(g._dwm.calls)
    g.reassert()
    assert len(g._dwm.calls) == n


def test_a_window_without_a_handle_stays_opaque(tmp_path):
    g, _ = make_glass(tmp_path, True)

    class Broken:
        @property
        def native(self):
            raise RuntimeError("not shown yet")

    g.attach_window(Broken())
    st = g.state()
    assert st["on"] is False and "no window handle" in st["reason"]


def test_window_api_exposes_set_glass_and_glass_state(tmp_path):
    g, _ = make_glass(tmp_path, True)
    g.attach(HWND)
    api = desktop.WindowApi(g)
    assert api.glass_state()["on"] is True
    assert api.set_glass(False)["on"] is False
    assert not hasattr(api, "glass")                               # the controller stays private to the page


# ------------------------------------------------------------ imports

def test_nothing_here_imports_the_gui_at_import_time():
    """backdrop and desktop must import without pywebview, WinForms or pythonnet: the
    window paints a splash before the heavy imports run (desktop.py, 10-25)."""
    code = ("import sys; import jarvis_app.backdrop, jarvis_app.desktop; "
            "bad = [m for m in ('webview', 'clr', 'System', 'Microsoft') if m in sys.modules]; "
            "print(bad); sys.exit(1 if bad else 0)")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


def test_the_real_dwm_class_is_only_built_on_first_use():
    g = backdrop.Glass(False)
    assert g._dwm is None
