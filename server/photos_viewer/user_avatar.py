"""#256: a user's own avatar, cropped from a photo they can see.

The crop is rendered once into a small JPEG under the data dir, so other
users can see it without any access to the source photo, and it keeps
working if that photo is later removed or the user loses the library.
"""

from __future__ import annotations

import io
import os
import pathlib
import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Response
from PIL import Image
from pydantic import BaseModel, Field

from . import library_assets, session_auth

router = APIRouter()

AVATAR_PX = 256


def avatar_path(data_dir: pathlib.Path, user_id: int) -> pathlib.Path:
    return pathlib.Path(data_dir) / "avatars" / f"{user_id}.jpg"


def remove_avatar_file(data_dir: pathlib.Path, user_id: int) -> None:
    avatar_path(data_dir, user_id).unlink(missing_ok=True)


class AvatarRequest(BaseModel):
    library_id: int
    asset_id: str
    # The crop square, as fractions of the preview image the picker shows.
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class AvatarResponse(BaseModel):
    avatar_version: int | None


@router.put(
    "/api/me/avatar",
    response_model=AvatarResponse,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def set_avatar(
    payload: AvatarRequest,
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    cache_dir: pathlib.Path = Depends(session_auth.get_media_cache_dir),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> AvatarResponse:
    if payload.x + payload.width > 1.001 or payload.y + payload.height > 1.001:
        raise HTTPException(status_code=422, detail="crop is outside the photo")
    # Same 404 as every other photo route for a library this user is not
    # assigned (an admin included), and for an unknown asset.
    library = db.execute(
        "SELECT libraries.* FROM libraries "
        "JOIN library_assignments ON library_assignments.library_id = libraries.id "
        "WHERE libraries.id = ? AND library_assignments.user_id = ?",
        (payload.library_id, session["user_id"]),
    ).fetchone()
    if library is None:
        raise HTTPException(status_code=404, detail="not found")
    asset = library_assets._get_asset_or_404(db, library["id"], payload.asset_id)
    if asset["hidden"]:
        # A Hidden photo's pixels must not outlive the Hidden unlock, and an
        # avatar is visible to everyone.
        raise HTTPException(status_code=404, detail="not found")
    source = library_assets.render_thumb(db, cache_dir, library, asset, "preview")
    try:
        with Image.open(io.BytesIO(source.data)) as image:
            image.load()
            w, h = image.size
            box = (
                round(payload.x * w),
                round(payload.y * h),
                min(w, round((payload.x + payload.width) * w)),
                min(h, round((payload.y + payload.height) * h)),
            )
            if box[2] - box[0] < 1 or box[3] - box[1] < 1:
                raise HTTPException(status_code=422, detail="crop is empty")
            square = (
                image.convert("RGB")
                .crop(box)
                .resize((AVATAR_PX, AVATAR_PX), Image.Resampling.LANCZOS)
            )
    except OSError as exc:
        raise HTTPException(status_code=415, detail="photo cannot be read") from exc
    out = io.BytesIO()
    square.save(out, "JPEG", quality=88)
    path = avatar_path(data_dir, session["user_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(out.getvalue())
    os.replace(tmp, path)
    version = time.time_ns() // 1_000_000
    db.execute(
        "UPDATE users SET avatar_version = ? WHERE id = ?",
        (version, session["user_id"]),
    )
    db.commit()
    return AvatarResponse(avatar_version=version)


@router.delete(
    "/api/me/avatar",
    status_code=204,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def delete_avatar(
    session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> None:
    db.execute(
        "UPDATE users SET avatar_version = NULL WHERE id = ?", (session["user_id"],)
    )
    db.commit()
    remove_avatar_file(data_dir, session["user_id"])


@router.get("/api/users/{username}/avatar")
def read_avatar(
    username: str,
    _session: sqlite3.Row = Depends(session_auth.require_session),
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> Response:
    row = db.execute(
        "SELECT id FROM users WHERE username = ? AND avatar_version IS NOT NULL "
        "AND disabled = 0",
        (username,),
    ).fetchone()
    path = avatar_path(data_dir, row["id"]) if row else None
    try:
        data = path.read_bytes() if path else None
    except OSError:
        data = None
    if data is None:
        # The UI falls back to the initial on any non-image answer.
        raise HTTPException(status_code=404, detail="not found")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )
