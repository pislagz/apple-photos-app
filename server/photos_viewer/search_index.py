"""D36: the SQLite FTS5 table behind Search.

One row per asset (rowid = `assets.id`), written by the indexer inside its
batch transactions, so a reader sees the old or the new index and never a
half-swapped one. Deleting an asset (re-index cleanup, library removal) drops
its row through a trigger (migration 25).

All folding and tokenising happens here, in Python, with the same rules the
scan in `library_search` uses; the FTS tokenizer only has to split on spaces
(`tokenchars '_-'` keeps `img_0012` and `2024-03-05` whole). Matching is then
`token LIKE term%` over every field at once, which is the same as "every term
is a word prefix of some field".

`txt` holds the words of the place, address, camera, file names, title,
description, people, albums and labels, plus the ISO day (`2024-03-05`) and,
for file names, the pieces of a name split on `_` (D64: `IMG_0012` finds
`0012`). `month` holds the month name alone, because a month matches only from
three letters and so cannot share a column with the rest.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from collections.abc import Iterable

_WORD = re.compile(r"\w+")
# A word is `\w+`, and only an ISO day carries a `-`, so a term with anything
# else in it (`d%`, `o'brien`) matches nothing, as the scan does; and FTS5 would
# otherwise tokenise the junk away and match the rest.
_UNMATCHABLE = re.compile(r"[^\w-]|^-*$")
_MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]

MIN_MONTH_PREFIX = 3

TABLE_SQL = (
    "CREATE VIRTUAL TABLE assets_fts USING fts5("
    "txt, month, tokenize = \"unicode61 remove_diacritics 0 tokenchars '_-'\", "
    "columnsize = 0)"
)


def fold(text: str | None) -> str:
    """Lower-case with accents removed (`Zürich` -> `zurich`)."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _words(text: str | None) -> list[str]:
    return _WORD.findall(fold(text))


def _filename_words(name: str | None) -> list[str]:
    words = _words(name)
    for word in list(words):
        if "_" in word:
            words.extend(part for part in word.split("_") if part)
    return words


def document(
    day: str | None,
    fields: Iterable[str | None],
    filenames: Iterable[str | None] = (),
) -> tuple[str, str]:
    """`(txt, month)` for one asset. `day` is the capture-location calendar day
    (`YYYY-MM-DD`); `fields` are the other searchable texts."""
    tokens: list[str] = []
    month = ""
    if day and len(day) >= 10:
        tokens.append(day[:10])
        if day[5:7].isdigit() and 1 <= int(day[5:7]) <= 12:
            month = _MONTHS[int(day[5:7]) - 1]
    for text in fields:
        tokens.extend(_words(text))
    for name in filenames:
        tokens.extend(_filename_words(name))
    return " ".join(tokens), month


def put(
    db: sqlite3.Connection, asset_id: int, doc: tuple[str, str], *, replace: bool
) -> None:
    if replace:
        db.execute("DELETE FROM assets_fts WHERE rowid = ?", (asset_id,))
    db.execute(
        "INSERT INTO assets_fts (rowid, txt, month) VALUES (?, ?, ?)", (asset_id, *doc)
    )


_REBUILD_SQL = """
SELECT a.id, COALESCE(a.date_created_local_day, substr(a.date_created, 1, 10)) AS day,
       a.place, a.place_address, a.camera_make, a.camera_model, a.title, a.description,
       a.filename, a.original_filename,
       (SELECT group_concat(COALESCE(p.name, '') || ' ' || COALESCE(p.display_name, ''), ' ')
          FROM asset_people ap JOIN people p ON p.id = ap.person_id
         WHERE ap.asset_id = a.id) AS people,
       (SELECT group_concat(al.title, ' ')
          FROM asset_albums aa JOIN albums al ON al.id = aa.album_id
         WHERE aa.asset_id = a.id) AS albums,
       (SELECT group_concat(label_normalized, ' ')
          FROM asset_labels WHERE asset_id = a.id) AS labels
  FROM assets a WHERE a.library_id = ?
"""


def rebuild_library(db: sqlite3.Connection, library_id: int) -> int:
    """Rewrite one library's rows from what `app.db` already holds. The indexer
    does not need it (it writes each row as it walks); this is for tests, the
    benchmark and repairs. Caller commits. Returns the row count."""
    db.execute(
        "DELETE FROM assets_fts WHERE rowid IN (SELECT id FROM assets WHERE library_id = ?)",
        (library_id,),
    )
    count = 0
    for row in db.execute(_REBUILD_SQL, (library_id,)).fetchall():
        doc = document(
            row["day"],
            (
                row["place"],
                row["place_address"],
                row["camera_make"],
                row["camera_model"],
                row["title"],
                row["description"],
                row["people"],
                row["albums"],
                row["labels"],
            ),
            (row["filename"], row["original_filename"]),
        )
        put(db, row["id"], doc, replace=False)
        count += 1
    return count


def match_expression(terms: list[str]) -> str | None:
    """The FTS5 MATCH string: every term a prefix in `txt`, or (from three
    letters) in `month`. None when a term can match nothing."""
    parts = []
    for term in terms:
        if _UNMATCHABLE.search(term):
            return None
        quoted = '"' + term.replace('"', '""') + '"*'
        if len(term) >= MIN_MONTH_PREFIX:
            parts.append(f"(txt : {quoted} OR month : {quoted})")
        else:
            parts.append(f"txt : {quoted}")
    return " AND ".join(parts)


def search_clause(terms: list[str]) -> tuple[str, list[object]]:
    """SQL condition on `assets`, the FTS twin of `library_search.scan_clause`."""
    expression = match_expression(terms)
    if expression is None:
        return "0", []
    return "id IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?)", [expression]
