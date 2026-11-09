"""P2.4: search one library's indexed assets.

Reads only `app.db`, behind `session_auth.require_library_assignment` (a
foreign `library_id` 404s). Imports no HTTP client and never geocodes: place
text is what the indexer copied from the library (P1.6).

Matching is plain: the query is split on whitespace and every term must match
(AND). A term matches when it is a word prefix, accent- and case-insensitively,
of any of: place name or address, a person, an album title, camera make or
model, or a label (Apple's scene/object labels in `asset_labels`); or when it
is a prefix of the capture year, the month name, or the ISO day. Hidden assets
are never searched. An empty query is an empty page, not the whole library.
"""

from __future__ import annotations

import calendar
import re
import sqlite3
import unicodedata
from typing import Literal

from fastapi import APIRouter, Depends, Query

from . import library_assets, session_auth

router = APIRouter()

MAX_TERMS = 8
MAX_TERM_LENGTH = 64

_WORD = re.compile(r"\w+")
_MONTHS = [calendar.month_name[n].lower() for n in range(1, 13)]


def fold(text: str | None) -> str:
    """Lower-case with accents removed (`Zürich` -> `zurich`)."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def parse_terms(q: str) -> list[str]:
    terms = [fold(t)[:MAX_TERM_LENGTH] for t in q.split()]
    return [t for t in terms if t][:MAX_TERMS]


def _word_prefix(text: str | None, term: str) -> bool:
    return any(word.startswith(term) for word in _WORD.findall(fold(text)))


def _date_match(day: str | None, term: str) -> bool:
    if not day or len(day) < 10:
        return False
    if term[0].isdigit() and day.startswith(term):  # `2024`, `2024-03`, `2024-03-05`
        return True
    month = (
        _MONTHS[int(day[5:7]) - 1]
        if day[5:7].isdigit() and 1 <= int(day[5:7]) <= 12
        else ""
    )
    return len(term) >= 3 and month.startswith(term)


def _register(db: sqlite3.Connection) -> None:
    db.create_function("pv_wp", 2, _word_prefix, deterministic=True)
    db.create_function("pv_date", 2, _date_match, deterministic=True)


def search_clause(terms: list[str]) -> tuple[str, list[object]]:
    """SQL condition (on `assets`) that every term matches some field."""
    parts: list[str] = []
    params: list[object] = []
    for term in terms:
        parts.append(
            "("
            "pv_date(COALESCE(date_created_local_day, substr(date_created, 1, 10)), ?)"
            " OR pv_wp(place, ?) OR pv_wp(place_address, ?)"
            " OR pv_wp(camera_make, ?) OR pv_wp(camera_model, ?)"
            " OR id IN (SELECT ap.asset_id FROM asset_people ap JOIN people p ON p.id = ap.person_id"
            "           WHERE pv_wp(p.name, ?) OR pv_wp(p.display_name, ?))"
            " OR id IN (SELECT aa.asset_id FROM asset_albums aa JOIN albums al ON al.id = aa.album_id"
            "           WHERE pv_wp(al.title, ?))"
            " OR id IN (SELECT asset_id FROM asset_labels WHERE pv_wp(label_normalized, ?))"
            ")"
        )
        params.extend([term] * 9)
    return " AND ".join(parts), params


@router.get(
    "/api/libraries/{library_id}/search",
    response_model=library_assets.AssetListResponse,
)
def search_assets(
    q: str = Query("", max_length=500),
    cursor: str | None = None,
    limit: int = Query(library_assets.DEFAULT_LIMIT, ge=1, le=library_assets.MAX_LIMIT),
    type_: Literal["photo", "video"] | None = Query(None, alias="type"),
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> library_assets.AssetListResponse:
    terms = parse_terms(q)
    if not terms:
        return library_assets.AssetListResponse(items=[], next_cursor=None)
    _register(db)
    return library_assets._list_assets(
        db,
        library["id"],
        hidden=False,
        cursor=cursor,
        limit=limit,
        type_=type_,
        from_=None,
        to=None,
        extra=search_clause(terms),
    )
