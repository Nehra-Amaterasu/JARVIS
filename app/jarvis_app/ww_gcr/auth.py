"""Sign-in to the owner's Google account with his own desktop OAuth client (plan section 8).

    status(account)          -> {"state", "reason", "scopes", "missing"}   never a token, the client id or an address
    connect(timeout=300)     -> status(); opens the browser, he approves, the refresh token is kept
    access_token()           -> a fresh access token for api.GoogleApi (NotConnected when there is none)
    forget_token(account)    -> drops the cached access token (after Google answered 401 to it)
    disconnect()             -> revokes at Google when it can and forgets the token here either way

An account is a short name he chose ("main", "college"); nothing here stores or shows the address behind it.

Where things live, and why:
  * The client file (his download from the Cloud console) is read from data/google/client_secret.json, a folder outside
    data/app, because the sandbox copies data/app to a temporary folder for audits and a client secret must not travel there.
  * The refresh token goes to the operating system's credential store through keyring (Windows Credential Manager), not to a
    file: a file under data/ would reach the private backup, and the rule is that tokens are committed nowhere. That store
    takes about 1280 characters for one secret, so only the refresh token and the short scope names are kept; the access
    token (one hour) lives in memory and is fetched again when it is needed.
  * Every scope is read-only. Drive is asked for because a Classroom attachment is a Drive file; the owner asked for
    Calendar, Gmail and Contacts on the same client (22 Nov 2026), so one consent covers them.

Google lets a person untick scopes on the consent screen, so what was granted is recorded and `missing` names the rest;
nothing here pretends a scope it did not get.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable, Optional

from .. import paths

PREFIX = "https://www.googleapis.com/auth/"
# short name -> what it is for (the screen prints the right-hand side)
SCOPES: dict[str, str] = {
    "classroom.courses.readonly": "your Classroom courses",
    "classroom.coursework.me.readonly": "your coursework and its files",
    "classroom.courseworkmaterials.readonly": "course materials (notes, slides, papers)",
    "classroom.announcements.readonly": "course announcements",
    "classroom.topics.readonly": "the topics a course groups its posts under",
    "drive.readonly": "the files those posts attach (read only)",
    "calendar.readonly": "your calendar (read only)",
    "gmail.readonly": "your mail (read only)",
    "contacts.readonly": "your contacts (read only)",
}
# Google reports a granted scope under another name than the one asked for: on the first real consent (22 Nov 2026) the
# coursework scope came back as "classroom.student-submissions.me.readonly", and the status said "not granted: 1" while
# coursework was being read. The names Google answers with are mapped back to the names asked for.
ALIASES = {"classroom.student-submissions.me.readonly": "classroom.coursework.me.readonly"}
NEEDED_FOR_NOTES = ("classroom.courses.readonly", "classroom.courseworkmaterials.readonly", "drive.readonly")

SERVICE = "jarvis-google"
ACCOUNT = "refresh-token"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"

# More than one Google account (22 Nov 2026: his classes are split between a personal account and a university one). Each
# account is a short name he chooses; "main" keeps the first credential name, so a sign-in made before this still works.
MAIN = "main"
INDEX = "accounts"
_SLOT = re.compile(r"^[a-z][a-z0-9-]{0,19}$")

_lock = threading.Lock()
_access: dict = {"token": "", "until": 0.0}        # main
_access_more: dict = {}                                # the other accounts, by name
# The last refresh Google refused, per account, in memory. The credential store alone says "live" for a refresh token Google
# already revoked; without this the screen showed Connected while every sync failed.
_failed: dict = {}
REVOKED = "Google no longer accepts the sign-in (revoked, or the test period of 7 days ended). Connect again."
UNTOLD = ("Forgotten on this PC. Google could not be told (offline): remove the app's access in your Google account to finish.")


def _slot(account: str) -> str:
    if not _SLOT.match(account or ""):
        raise ValueError("an account name is a short word of lower-case letters, digits and -")
    return ACCOUNT if account == MAIN else f"{ACCOUNT}:{account}"


def _cache(account: str) -> dict:
    return _access if account == MAIN else _access_more.setdefault(account, {"token": "", "until": 0.0})


def accounts() -> list[str]:
    """The names that hold a sign-in, main first. Names only: nothing here identifies a person."""
    try:
        more = json.loads(_keyring().get_password(SERVICE, INDEX) or "[]")
    except Exception:
        more = []
    names = [MAIN] + sorted(a for a in more if isinstance(a, str) and _SLOT.match(a) and a != MAIN)
    return [a for a in names if _stored(a)]


def _index(account: str, add: bool) -> None:
    if account == MAIN:
        return
    try:
        more = set(json.loads(_keyring().get_password(SERVICE, INDEX) or "[]"))
    except Exception:
        more = set()
    (more.add if add else more.discard)(account)
    _keyring().set_password(SERVICE, INDEX, json.dumps(sorted(more)))


class NotConnected(RuntimeError):
    """No usable sign-in: the reason is a sentence the screen can print."""


def client_path() -> Path:
    return Path(os.environ.get("JARVIS_GOOGLE_CLIENT") or (paths.REPO / "data" / "google" / "client_secret.json"))


def _keyring():
    import keyring
    return keyring


def _read_client() -> dict:
    p = client_path()
    if not p.is_file():
        raise NotConnected("The Google client file is not in the private data folder yet.")
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        info = raw.get("installed") or {}
        if not (info.get("client_id") and info.get("client_secret")):
            raise ValueError
        return raw
    except (OSError, ValueError):
        raise NotConnected("The Google client file is not a desktop app client.") from None


def _stored(account: str = MAIN) -> Optional[dict]:
    name = _slot(account)                       # outside the try: a bad name is the caller's error, not "not connected"
    try:
        raw = _keyring().get_password(SERVICE, name)
    except Exception:
        return None
    if not raw:
        return None
    try:
        d = json.loads(raw)
        return d if d.get("r") else None
    except ValueError:
        return None


def _store(refresh_token: str, granted: list[str], account: str = MAIN) -> None:
    short = sorted(s[len(PREFIX):] for s in granted if s.startswith(PREFIX))
    _keyring().set_password(SERVICE, _slot(account), json.dumps({"r": refresh_token, "s": short}, separators=(",", ":")))
    _index(account, True)


def status(account: str = MAIN) -> dict:
    """What the screen shows. Never a token, the client id or an address: `account` is the short name he chose."""
    _slot(account)
    try:
        _read_client()
    except NotConnected as e:
        return {"state": "planned", "reason": str(e), "scopes": [], "missing": sorted(SCOPES)}
    st = _stored(account)
    if not st:
        return {"state": "waiting", "reason": "Not connected. Press Connect and approve in the browser.",
                "scopes": [], "missing": sorted(SCOPES)}
    have = sorted({ALIASES.get(s, s) for s in st.get("s", [])} & set(SCOPES))
    missing = sorted(set(SCOPES) - set(have))
    with _lock:
        failed = _failed.get(account, "")
    if failed:
        return {"state": "fault", "reason": failed, "scopes": have, "missing": missing}
    lacking = [s for s in NEEDED_FOR_NOTES if s not in have]
    if lacking:
        return {"state": "fault", "reason": "Connected, but notes need a permission that was not ticked: "
                + ", ".join(SCOPES[s] for s in lacking) + ". Connect again and tick it.", "scopes": have, "missing": missing}
    return {"state": "live", "reason": "Connected, read only." + (f" Not granted: {len(missing)}." if missing else ""),
            "scopes": have, "missing": missing}


def connect(timeout: int = 300, open_browser: bool = True, flow_factory: Optional[Callable] = None, account: str = MAIN) -> dict:
    """The installed-app flow on a loopback port: the browser opens, he approves, Google redirects to this machine.
    Blocks until then or until `timeout` seconds. `flow_factory` is the test seam."""
    _slot(account)
    raw = _read_client()
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")     # an unticked scope is a smaller grant, not an error
    if flow_factory is None:
        from google_auth_oauthlib.flow import InstalledAppFlow
        flow_factory = InstalledAppFlow.from_client_config
    flow = flow_factory(raw, scopes=[PREFIX + s for s in SCOPES])
    creds = flow.run_local_server(host="localhost", bind_addr="127.0.0.1", port=0, open_browser=open_browser,
                                  timeout_seconds=timeout, access_type="offline", prompt="consent select_account",
                                  authorization_prompt_message="", success_message="Connected. You can close this tab and go back to the app.")
    if not getattr(creds, "refresh_token", None):
        raise NotConnected("Google returned no refresh token. Connect again and approve the whole screen.")
    granted = list(getattr(creds, "granted_scopes", None) or getattr(creds, "scopes", None) or [])
    _store(creds.refresh_token, granted, account)
    with _lock:
        _cache(account).update(token=creds.token or "", until=time.time() + 3000 if creds.token else 0.0)
        _failed.pop(account, None)
    return status(account)


def forget_token(account: str = MAIN) -> None:
    with _lock:
        _cache(account).update(token="", until=0.0)


def access_token(post: Optional[Callable] = None, account: str = MAIN) -> str:
    """A valid access token, refreshed with the stored refresh token when the last one is about to end."""
    with _lock:
        c = _cache(account)
        if c["token"] and c["until"] - time.time() > 60:
            return c["token"]
    st = _stored(account)
    if not st:
        raise NotConnected("Not connected to Google.")
    info = _read_client()["installed"]
    if post is None:
        import httpx
        post = lambda url, data: httpx.post(url, data=data, timeout=20)      # noqa: E731
    r = post(TOKEN_URI, {"client_id": info["client_id"], "client_secret": info["client_secret"],
                         "refresh_token": st["r"], "grant_type": "refresh_token"})
    if r.status_code != 200:
        # invalid_grant: revoked, or the seven-day limit of a client still in testing
        try:
            code = r.json().get("error", "")
        except ValueError:
            code = ""
        if code == "invalid_grant":
            with _lock:
                _failed[account] = REVOKED            # status() says fault until a connect or a refresh succeeds
            raise NotConnected(REVOKED)
        raise NotConnected(f"Google refused to renew the sign-in (HTTP {r.status_code}).")
    body = r.json()
    with _lock:
        _cache(account).update(token=body["access_token"], until=time.time() + float(body.get("expires_in", 3600)))
        _failed.pop(account, None)
        return _cache(account)["token"]


def disconnect(post: Optional[Callable] = None, account: str = MAIN) -> dict:
    """Revoke at Google, then forget here whatever happened there. When Google could not be told, the reason says so: the
    grant still lives in his Google account until he removes it, and a silent "disconnected" would hide that."""
    st = _stored(account)
    untold = False
    if st:
        try:
            if post is None:
                import httpx
                post = lambda url, data: httpx.post(url, data=data, timeout=20)  # noqa: E731
            r = post(REVOKE_URI, {"token": st["r"]})
            # 200 is revoked; 400 is a token Google already holds as dead (nothing left to remove); 5xx is not told
            untold = getattr(r, "status_code", 200) >= 500
        except Exception:
            untold = True                           # offline: the local token is still forgotten below
        try:
            _keyring().delete_password(SERVICE, _slot(account))
        except Exception:
            pass
        try:
            _index(account, False)                  # apart: a failed delete must not leave the name listed
        except Exception:
            pass
    with _lock:
        _cache(account).update(token="", until=0.0)
        _failed.pop(account, None)
    out = status(account)
    if untold:
        out["reason"] = UNTOLD
    return out


if __name__ == "__main__":                          # python -m jarvis_app.ww_gcr.auth connect|status|disconnect
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    who = sys.argv[2] if len(sys.argv) > 2 else MAIN
    out = {"connect": connect, "disconnect": disconnect}.get(cmd, status)(account=who)
    print(json.dumps({k: out[k] for k in ("state", "reason", "scopes", "missing")}, indent=1))
