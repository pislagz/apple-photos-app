"""P2.2: the People list for one library.

Reads only `app.db`, never a `.photoslibrary` path, behind
`session_auth.require_library_assignment` (a foreign `library_id` 404s).

Unnamed face groups are listed too, as Apple Photos does: `name` is null, and
they come after every named person, most photos first. `person=` accepts them.
People whose every asset is hidden are left out, named or not. Hidden assets
never count and are never used as the cover face.

A person's photos are listed through `GET /assets?person=<uuid>` (see
`library_assets.py`). The circular crop is applied client-side: the list gives
the cover photo's id plus the face rectangle, and the browser shows the
ordinary same-origin thumbnail clipped to a circle. No extra image route, so
nothing new for the CSP or the access checks.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import session_auth

router = APIRouter()


# A person Photos has not been given a name for has neither field.
def _label_sql(alias: str = "") -> str:
    p = f"{alias}." if alias else ""
    return f"COALESCE(NULLIF(TRIM({p}name), ''), NULLIF(TRIM({p}display_name), ''))"


def person_clause(
    db: sqlite3.Connection, library_id: int, person: str
) -> tuple[str, list[object]]:
    """SQL condition (on `assets`) for a `person=` value; 404 unless it is a
    person (named or not) of *this* library."""
    row = db.execute(
        "SELECT id FROM people WHERE library_id = ? AND uuid = ?",
        (library_id, person),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return "id IN (SELECT asset_id FROM asset_people WHERE person_id = ?)", [row["id"]]


def unnamed_label(index: int) -> str:
    """1 -> "Person A", 26 -> "Person Z", 27 -> "Person AA" (bijective base 26,
    like spreadsheet columns)."""
    if index < 1:
        raise ValueError("index starts at 1")
    letters = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return f"Person {letters}"


class FaceCrop(BaseModel):
    # Thumbnail of this asset, cropped around the face. x/y: face centre,
    # w/h: face size, all as fractions of the displayed image, top-left origin.
    asset_id: str
    x: float
    y: float
    w: float
    h: float


class Person(BaseModel):
    id: str
    name: str | None  # null: an unnamed face group
    # What to show: the name, or a generated "Person A" for an unnamed group.
    # Letters follow this list's order, so list and page agree.
    label: str
    count: int
    cover: FaceCrop | None


class PeopleResponse(BaseModel):
    people: list[Person]


@router.get("/api/libraries/{library_id}/people", response_model=PeopleResponse)
def list_people(
    library: sqlite3.Row = Depends(session_auth.require_library_assignment),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> PeopleResponse:
    library_id = library["id"]
    covers = {
        row["person_id"]: FaceCrop(
            asset_id=row["uuid"], x=row["x"], y=row["y"], w=row["w"], h=row["h"]
        )
        for row in db.execute(
            """
            SELECT person_id, uuid, x, y, w, h FROM (
                SELECT f.person_id, a.uuid, f.x, f.y, f.w, f.h,
                       ROW_NUMBER() OVER (
                           PARTITION BY f.person_id ORDER BY f.quality DESC, a.date_created DESC, f.id
                       ) AS rn
                FROM faces f JOIN assets a ON a.id = f.asset_id
                WHERE a.library_id = ? AND a.hidden = 0
            ) WHERE rn = 1
            """,
            (library_id,),
        )
    }
    out: list[Person] = []
    for row in db.execute(
        f"""
        SELECT p.id, p.uuid, {_label_sql("p")} AS label,
               (SELECT COUNT(*) FROM asset_people ap JOIN assets a ON a.id = ap.asset_id
                WHERE ap.person_id = p.id AND a.hidden = 0) AS n
        FROM people p WHERE p.library_id = ?
        """,
        (library_id,),
    ):
        if row["n"] == 0:
            continue
        out.append(
            Person(
                id=row["uuid"],
                name=row["label"],
                label=row["label"] or "",
                count=row["n"],
                cover=covers.get(row["id"]),
            )
        )
    # Named people first, then unnamed groups; each most photos first.
    # The group id breaks ties so the generated letters stay stable.
    out.sort(key=lambda p: (p.name is None, -p.count, (p.name or "").lower(), p.id))
    unnamed = 0
    for person in out:
        if person.name is None:
            unnamed += 1
            person.label = unnamed_label(unnamed)
    return PeopleResponse(people=out)
