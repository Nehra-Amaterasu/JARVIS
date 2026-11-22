"""A thin, read-only client for Google's REST APIs over httpx.

Why not the discovery client: it is a large dependency, and httpx is already pinned and takes an injected transport, so
every test runs against a fake Google (the test suite blocks real sockets). Only GET is offered: this module cannot write.

    api = GoogleApi()                      # token from auth.access_token
    api.get(url, params)                   -> dict
    api.pages(url, "courses", params)      -> every item across nextPageToken pages
    api.file_meta(file_id)                 -> Drive metadata (with a shortcut's target)
    api.download(file_id, dest)            -> bytes written (a Drive file as it is)
    api.export(file_id, mime, dest)        -> bytes written (a Google Doc, Slides or Sheet as another format)
    replace_with_retry(src, dst)           -> os.replace that waits out a reader's open handle on Windows
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

import httpx

from . import auth

DRIVE = "https://www.googleapis.com/drive/v3"
MAX_FILE = 200 * 1024 * 1024      # a lecture deck with pictures is tens of MB; a longer file is refused, not half-written
META_FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,shortcutDetails(targetId,targetMimeType)"
# On Windows a file another program has open cannot be replaced: os.replace raises PermissionError while the reader's handle
# lives (the app's own reader, an indexer, a virus scanner). Those handles last milliseconds; 10 tries 50 ms apart is half a
# second, which outlasts them, and a viewer that keeps the file open is still a refusal, not a hang.
REPLACE_TRIES = 10
REPLACE_WAIT = 0.05
# Mark of the Web: zone 3 is "Internet". Word and PowerPoint open a file with this mark in Protected View, which is what a
# file from a stranger's Drive deserves; without it a macro document fetched here would open with full rights.
ZONE_MARK = "[ZoneTransfer]\r\nZoneId=3\r\n"


class ApiError(RuntimeError):
    """A refusal from Google as a sentence the screen can print; `status` is the HTTP status."""

    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status


def replace_with_retry(src, dst, tries: int = REPLACE_TRIES, wait: float = REPLACE_WAIT) -> None:
    for n in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if n == tries - 1:
                raise
            time.sleep(wait)


def mark_from_internet(path: Path) -> bool:
    """Write the Zone.Identifier stream on Windows. False where there are no streams (FAT, a network share) or no Windows."""
    if sys.platform != "win32":
        return False
    try:
        with open(str(path) + ":Zone.Identifier", "w", encoding="ascii", newline="") as f:
            f.write(ZONE_MARK)
        return True
    except OSError:
        return False


def _explain(r: httpx.Response) -> str:
    try:
        err = r.json().get("error", {})
    except ValueError:
        err = {}
    if not isinstance(err, dict):
        err = {}
    reasons = " ".join(str(d.get("reason", "")) for d in (err.get("details") or []) + (err.get("errors") or []) if isinstance(d, dict))
    text = f"{err.get('status', '')} {err.get('message', '')} {reasons}"
    host = r.request.url.host if r.request else ""
    name = {"classroom.googleapis.com": "Google Classroom", "www.googleapis.com": "Google Drive", "gmail.googleapis.com": "Gmail",
            "people.googleapis.com": "People (Contacts)"}.get(host, "This Google")
    if r.status_code == 403 and ("SERVICE_DISABLED" in text or "accessNotConfigured" in text or "has not been used in project" in text):
        return f"The {name} API is not switched on in your Google Cloud project."
    if r.status_code == 403 and ("insufficient" in text.lower() or "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in text):
        return "That permission was not granted at sign-in. Connect again and tick it."
    if r.status_code == 403 and "cannotDownload" in text:
        return "The owner of this file does not allow downloads."
    if r.status_code == 403 and "exportSizeLimitExceeded" in text:
        # Drive's export endpoint stops at 10 MB of output; before this the sentence blamed his account's rights
        return "Too large for Google to export as PDF (over 10 MB): open it in Google Drive."
    if r.status_code == 403:
        return "Google refused: your account may not see this."
    if r.status_code == 404:
        return "Not found: it was removed, or your account cannot see it."
    if r.status_code == 429:
        return "Google asked to slow down. Try again in a few minutes."
    return f"Google answered HTTP {r.status_code}."


REJECTED = "Google did not accept the sign-in. Connect again."


class GoogleApi:
    def __init__(self, token: Optional[Callable[[], str]] = None, transport: Optional[httpx.BaseTransport] = None, timeout: float = 30.0,
                 on_unauthorized: Optional[Callable[[], Any]] = None):
        """`on_unauthorized` forgets the cached access token after a 401, so the one retry asks for a new one. Without it the
        default sign-in forgets the main account's token; an injected `token` with no hook just retries once."""
        self._token = token or auth.access_token
        if on_unauthorized is None and token is None:
            on_unauthorized = auth.forget_token
        self._on_401 = on_unauthorized
        self._client = httpx.Client(transport=transport, timeout=timeout, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token()}"}

    def _rejected(self) -> None:
        """A 401: the cached token is dead (revoked, or ended early). Up to 3000 s of later requests would reuse it."""
        if self._on_401 is not None:
            self._on_401()

    def get(self, url: str, params: Optional[dict] = None) -> dict:
        for attempt in range(2):
            r = self._client.get(url, params=params, headers=self._headers())
            if r.status_code != 401:
                break
            if attempt == 0:
                self._rejected()
        if r.status_code == 401:
            raise auth.NotConnected(REJECTED)
        if r.status_code != 200:
            raise ApiError(r.status_code, _explain(r))
        return r.json()

    def pages(self, url: str, key: str, params: Optional[dict] = None, limit: int = 5000) -> Iterator[dict]:
        params = dict(params or {})
        seen = 0
        while True:
            body = self.get(url, params)
            for item in body.get(key) or []:
                yield item
                seen += 1
                if seen >= limit:
                    return
            token = body.get("nextPageToken")
            if not token:
                return
            params["pageToken"] = token

    def file_meta(self, file_id: str) -> dict:
        return self.get(f"{DRIVE}/files/{file_id}", {"fields": META_FIELDS, "supportsAllDrives": "true"})

    def _stream(self, url: str, params: dict, dest: Path, max_bytes: int) -> int:
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        n = 0
        try:
            for attempt in range(2):
                with self._client.stream("GET", url, params=params, headers=self._headers()) as r:
                    if r.status_code == 401:
                        if attempt == 0:
                            self._rejected()
                            continue
                        raise auth.NotConnected(REJECTED)
                    if r.status_code != 200:
                        r.read()
                        raise ApiError(r.status_code, _explain(r))
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_bytes(1 << 16):
                            n += len(chunk)
                            if n > max_bytes:
                                raise ApiError(413, f"The file is larger than {max_bytes // (1024 * 1024)} MB and was not fetched.")
                            f.write(chunk)
                    break
            replace_with_retry(tmp, dest)          # whole or not at all: a half file never takes the name
            mark_from_internet(dest)
            return n
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass

    def download(self, file_id: str, dest: Path, max_bytes: int = MAX_FILE) -> int:
        return self._stream(f"{DRIVE}/files/{file_id}", {"alt": "media", "supportsAllDrives": "true"}, dest, max_bytes)

    def export(self, file_id: str, mime: str, dest: Path, max_bytes: int = MAX_FILE) -> int:
        return self._stream(f"{DRIVE}/files/{file_id}/export", {"mimeType": mime}, dest, max_bytes)


def as_reason(e: Exception) -> str:
    if isinstance(e, (ApiError, auth.NotConnected)):
        return str(e)
    if isinstance(e, httpx.HTTPError):
        return "The connection to Google dropped. Try again when the network is back."
    return f"{type(e).__name__}"


__all__ = ["GoogleApi", "ApiError", "DRIVE", "MAX_FILE", "META_FIELDS", "as_reason", "replace_with_retry", "mark_from_internet"]
