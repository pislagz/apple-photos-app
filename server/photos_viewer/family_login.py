"""#519 Family login: the public "Who's watching?" profile list, profile
sign-in, and the admin settings for it.

The list is public only while Family login is on, and carries nothing but id,
display name and an avatar URL. Whether a profile has a password is not on it:
the sign-in answers `password_required` instead, so the list reveals no more
than the sign-in form already does. Everything is enforced here; the web app
only mirrors it.
"""

from __future__ import annotations

import pathlib
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from . import app_db, session_auth
from .user_avatar import avatar_path

router = APIRouter()

_PUBLIC = [Depends(session_auth._enforce_tailnet_allowlist)]


class Profile(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None


class ProfilesResponse(BaseModel):
    profiles: list[Profile]


def _shown_users_query() -> str:
    return (
        "SELECT id, username, avatar_version FROM users "
        "WHERE disabled = 0 AND show_on_profiles = 1 ORDER BY username"
    )


@router.get("/api/auth/profiles", response_model=ProfilesResponse, dependencies=_PUBLIC)
def list_profiles(db: sqlite3.Connection = Depends(session_auth.get_db)):
    if not session_auth.family_login_enabled(db):
        raise HTTPException(status_code=404, detail="not found")
    rows = db.execute(_shown_users_query()).fetchall()
    return ProfilesResponse(
        profiles=[
            Profile(
                id=row["id"],
                display_name=row["username"],
                avatar_url=(
                    f"/api/auth/profiles/{row['id']}/avatar?v={row['avatar_version']}"
                    if row["avatar_version"] is not None
                    else None
                ),
            )
            for row in rows
        ]
    )


@router.get("/api/auth/profiles/{user_id}/avatar", dependencies=_PUBLIC)
def read_profile_avatar(
    user_id: int,
    db: sqlite3.Connection = Depends(session_auth.get_db),
    data_dir: pathlib.Path = Depends(session_auth.get_data_dir),
) -> Response:
    row = db.execute(
        "SELECT id FROM users WHERE id = ? AND avatar_version IS NOT NULL "
        "AND disabled = 0 AND show_on_profiles = 1",
        (user_id,),
    ).fetchone()
    if row is None or not session_auth.family_login_enabled(db):
        raise HTTPException(status_code=404, detail="not found")
    try:
        data = avatar_path(data_dir, row["id"]).read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="not found") from exc
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


class ProfileLoginRequest(BaseModel):
    user_id: int
    password: session_auth.LoginPassword = ""
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


@router.post(
    "/api/auth/profile-login",
    response_model=session_auth.AuthUserResponse,
    dependencies=[
        Depends(session_auth.reject_cross_site_requests),
        Depends(session_auth._enforce_tailnet_allowlist),
    ],
)
def profile_login(
    payload: ProfileLoginRequest,
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> session_auth.AuthUserResponse:
    if not session_auth.family_login_enabled(db):
        raise HTTPException(status_code=404, detail="not found")
    user = db.execute(
        "SELECT * FROM users WHERE id = ? AND show_on_profiles = 1", (payload.user_id,)
    ).fetchone()
    # Unknown or hidden-from-screen: the same answer as a wrong password
    # for a name that does not exist, and the same Argon2 work.
    username = user["username"] if user is not None else f"\0profile:{payload.user_id}"
    login_payload = session_auth.LoginRequest.model_construct(
        username=username,
        password=payload.password,
        remember_me=payload.remember_me,
        client=payload.client,
    )
    return session_auth.authenticate_and_start_session(
        login_payload, request, response, db, user=user, via_profile=True
    )


class FamilyLoginSettings(BaseModel):
    enabled: bool = True
    passwordless_signin: Literal["private", "anywhere"] = "private"


@router.get("/api/admin/settings/family-login", response_model=FamilyLoginSettings)
def read_settings(
    _admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> FamilyLoginSettings:
    return FamilyLoginSettings(
        enabled=session_auth.family_login_enabled(db),
        passwordless_signin=session_auth.passwordless_mode(db),  # type: ignore[arg-type]
    )


@router.put(
    "/api/admin/settings/family-login",
    response_model=FamilyLoginSettings,
    dependencies=[Depends(session_auth.reject_cross_site_requests)],
)
def write_settings(
    payload: FamilyLoginSettings,
    admin: sqlite3.Row = Depends(session_auth.require_admin),
    db: sqlite3.Connection = Depends(session_auth.get_db),
) -> FamilyLoginSettings:
    app_db.set_setting(
        db, session_auth.FAMILY_LOGIN_SETTING, "1" if payload.enabled else "0"
    )
    app_db.set_setting(
        db, session_auth.PASSWORDLESS_SETTING, payload.passwordless_signin
    )
    app_db.write_audit_log(
        db,
        "set_family_login",
        actor=admin["username"],
        detail=f"enabled={payload.enabled},passwordless={payload.passwordless_signin}",
    )
    return payload
