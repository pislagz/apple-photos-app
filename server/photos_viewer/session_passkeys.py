"""P3.1: WebAuthn passkeys beside the password.

Registration needs a signed-in session; sign-in is discoverable (no username
typed) and ends in `session_auth.start_session`, the same code path as the
password login, so cookie flags and lifetimes are identical. Challenges live
in `app.db`, single-use and short-lived. Attestation is always `none`: the
server never fetches FIDO metadata or anything else, so it makes no outbound
requests (CLAUDE.md).

Relying party: `PHOTOS_VIEWER_WEBAUTHN_RP_ID` and
`PHOTOS_VIEWER_WEBAUTHN_ORIGINS` (comma-separated `scheme://host[:port]`)
override; otherwise the RP ID is the request's host name and the expected
origin is the request's own origin (or `PHOTOS_VIEWER_PUBLIC_ORIGINS`, when
set), which is what the browser shows behind `tailscale serve`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sqlite3
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from . import app_db, session_auth
from .session_auth import (
    AuthUserResponse,
    _client_ip,
    _enforce_tailnet_allowlist,
    _ip_lockout_key,
    _prune_old_login_failures,
    get_db,
    reject_cross_site_requests,
    require_session,
)

logger = logging.getLogger(__name__)

_RP_ID_ENV = "PHOTOS_VIEWER_WEBAUTHN_RP_ID"
_ORIGINS_ENV = "PHOTOS_VIEWER_WEBAUTHN_ORIGINS"
_RP_NAME = "Photos Viewer"

CHALLENGE_LIFETIME_SECONDS = 120
# Unauthenticated login/options calls create rows; keep the table bounded.
MAX_PENDING_CHALLENGES = 500
MAX_PASSKEYS_PER_USER = 20

router = APIRouter()


def _origin_string(scheme: str, host: str, port: int | None) -> str:
    host_part = f"[{host}]" if ":" in host else host
    default = {"http": 80, "https": 443}.get(scheme)
    return (
        f"{scheme}://{host_part}"
        if port in (None, default)
        else f"{scheme}://{host_part}:{port}"
    )


def _relying_party(request: Request) -> tuple[str, list[str]]:
    """`(rp_id, expected_origins)` for this request."""
    rp_id = (
        os.environ.get(_RP_ID_ENV, "").strip().lower()
        or (request.url.hostname or "").lower()
    )
    raw = os.environ.get(_ORIGINS_ENV, "")
    origins = [entry.strip().rstrip("/") for entry in raw.split(",") if entry.strip()]
    if not origins:
        public = session_auth._public_origins_from_env()
        if public:
            origins = sorted(_origin_string(*origin) for origin in public)
        else:
            origins = [_origin_string(*session_auth._request_origin(request))]
    return rp_id, origins


def _user_handle(user_id: int) -> bytes:
    """Opaque, stable WebAuthn user handle: not the username, and no more
    identifying than the row id."""
    return hashlib.sha256(f"photos-viewer:passkey-user:{user_id}".encode()).digest()


def _store_challenge(
    db: sqlite3.Connection, purpose: str, challenge: bytes, user_id: int | None
) -> str:
    db.execute("DELETE FROM passkey_challenges WHERE expires_at <= datetime('now')")
    db.execute(
        "DELETE FROM passkey_challenges WHERE id IN "
        "(SELECT id FROM passkey_challenges ORDER BY expires_at LIMIT MAX(0, "
        "(SELECT COUNT(*) FROM passkey_challenges) - ?))",
        (MAX_PENDING_CHALLENGES - 1,),
    )
    challenge_id = secrets.token_urlsafe(24)
    db.execute(
        "INSERT INTO passkey_challenges (id, purpose, challenge, user_id, expires_at) "
        "VALUES (?, ?, ?, ?, datetime('now', ?))",
        (
            challenge_id,
            purpose,
            challenge,
            user_id,
            f"+{CHALLENGE_LIFETIME_SECONDS} seconds",
        ),
    )
    db.commit()
    return challenge_id


def _consume_challenge(
    db: sqlite3.Connection, challenge_id: str, purpose: str, user_id: int | None
) -> bytes:
    """Delete-and-return in one statement, so a challenge verifies at most
    once even if two requests race; an expired, unknown, replayed, or
    wrong-purpose/wrong-user id is the same 400."""
    row = db.execute(
        "DELETE FROM passkey_challenges WHERE id = ? AND purpose = ? "
        "AND expires_at > datetime('now') AND user_id IS ? RETURNING challenge",
        (challenge_id, purpose, user_id),
    ).fetchone()
    db.commit()
    if row is None:
        raise HTTPException(status_code=400, detail="challenge expired or already used")
    return bytes(row["challenge"])


def _credential_id_of(credential: dict[str, Any]) -> bytes | None:
    raw = credential.get("rawId") or credential.get("id")
    try:
        return base64url_to_bytes(raw) if isinstance(raw, str) else None
    except ValueError:
        return None


class OptionsResponse(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class RegisterVerifyRequest(BaseModel):
    challenge_id: str = Field(max_length=200)
    credential: dict[str, Any]
    name: Annotated[str, Field(max_length=64)] = ""


class PasskeyResponse(BaseModel):
    id: str
    name: str
    created_at: str
    last_used_at: str | None


def _passkey_response(row: sqlite3.Row) -> PasskeyResponse:
    return PasskeyResponse(
        id=row["public_id"],
        name=row["name"],
        created_at=row["created_at"],
        last_used_at=row["last_used_at"],
    )


@router.post(
    "/api/auth/passkeys/register/options",
    response_model=OptionsResponse,
    dependencies=[Depends(reject_cross_site_requests)],
)
def register_options(
    request: Request,
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> OptionsResponse:
    rp_id, _ = _relying_party(request)
    existing = db.execute(
        "SELECT credential_id FROM passkeys WHERE user_id = ?", (session["user_id"],)
    ).fetchall()
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=_RP_NAME,
        user_name=session["username"],
        user_id=_user_handle(session["user_id"]),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=bytes(row["credential_id"]))
            for row in existing
        ],
    )
    challenge_id = _store_challenge(
        db, "register", options.challenge, session["user_id"]
    )
    return OptionsResponse(
        challenge_id=challenge_id, options=json.loads(options_to_json(options))
    )


@router.post(
    "/api/auth/passkeys/register/verify",
    status_code=201,
    response_model=PasskeyResponse,
    dependencies=[Depends(reject_cross_site_requests)],
)
def register_verify(
    payload: RegisterVerifyRequest,
    request: Request,
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> PasskeyResponse:
    challenge = _consume_challenge(
        db, payload.challenge_id, "register", session["user_id"]
    )
    (count,) = db.execute(
        "SELECT COUNT(*) FROM passkeys WHERE user_id = ?", (session["user_id"],)
    ).fetchone()
    if count >= MAX_PASSKEYS_PER_USER:
        raise HTTPException(status_code=409, detail="passkey limit reached")
    rp_id, origins = _relying_party(request)
    try:
        verified = verify_registration_response(
            credential=payload.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            require_user_verification=True,
        )
    except Exception as exc:
        logger.info("passkey registration rejected: %s", exc)
        raise HTTPException(
            status_code=400, detail="passkey registration failed"
        ) from exc

    transports = payload.credential.get("response", {}).get("transports")
    public_id = secrets.token_hex(16)
    name = payload.name.strip() or "Passkey"
    try:
        db.execute(
            "INSERT INTO passkeys (public_id, user_id, credential_id, public_key, sign_count, transports, name) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                public_id,
                session["user_id"],
                verified.credential_id,
                verified.credential_public_key,
                verified.sign_count,
                json.dumps(transports) if isinstance(transports, list) else None,
                name,
            ),
        )
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="passkey already registered"
        ) from exc
    db.commit()
    app_db.write_audit_log(
        db,
        "passkey_add",
        user_id=session["user_id"],
        actor=session["username"],
        detail=public_id,
    )
    row = db.execute(
        "SELECT * FROM passkeys WHERE public_id = ?", (public_id,)
    ).fetchone()
    return _passkey_response(row)


@router.get("/api/auth/passkeys", response_model=list[PasskeyResponse])
def list_passkeys(
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> list[PasskeyResponse]:
    rows = db.execute(
        "SELECT * FROM passkeys WHERE user_id = ? ORDER BY id", (session["user_id"],)
    ).fetchall()
    return [_passkey_response(row) for row in rows]


@router.delete(
    "/api/auth/passkeys/{passkey_id}",
    status_code=204,
    dependencies=[Depends(reject_cross_site_requests)],
)
def delete_passkey(
    passkey_id: str,
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """Only the caller's own passkeys: someone else's id is a 404, like a
    foreign library id."""
    cursor = db.execute(
        "DELETE FROM passkeys WHERE public_id = ? AND user_id = ?",
        (passkey_id, session["user_id"]),
    )
    db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="passkey not found")
    app_db.write_audit_log(
        db,
        "passkey_remove",
        user_id=session["user_id"],
        actor=session["username"],
        detail=passkey_id,
    )
    return Response(status_code=204)


class LoginVerifyRequest(BaseModel):
    challenge_id: str = Field(max_length=200)
    credential: dict[str, Any]
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


@router.post(
    "/api/auth/passkeys/login/options",
    response_model=OptionsResponse,
    dependencies=[
        Depends(reject_cross_site_requests),
        Depends(_enforce_tailnet_allowlist),
    ],
)
def login_options(
    request: Request, db: sqlite3.Connection = Depends(get_db)
) -> OptionsResponse:
    """Usernameless: no allow-list, so the authenticator offers whichever
    passkey it holds for this RP and nothing here reveals which users exist."""
    rp_id, _ = _relying_party(request)
    options = generate_authentication_options(
        rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED
    )
    challenge_id = _store_challenge(db, "login", options.challenge, None)
    return OptionsResponse(
        challenge_id=challenge_id, options=json.loads(options_to_json(options))
    )


@router.post(
    "/api/auth/passkeys/login/verify",
    response_model=AuthUserResponse,
    dependencies=[
        Depends(reject_cross_site_requests),
        Depends(_enforce_tailnet_allowlist),
    ],
)
def login_verify(
    payload: LoginVerifyRequest,
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
) -> AuthUserResponse:
    _prune_old_login_failures(db)
    peer_ip = _client_ip(request)
    ip_key = _ip_lockout_key(request)
    if ip_key is not None and session_auth.is_ip_locked_out(db, ip_key, peer_ip):
        raise HTTPException(
            status_code=429, detail="too many failed attempts, try again later"
        )
    try:
        challenge = _consume_challenge(db, payload.challenge_id, "login", None)
    except HTTPException:
        # An unknown/expired/replayed id counts like any other failed attempt.
        if ip_key is not None:
            session_auth.record_ip_login_failure(db, ip_key, peer_ip)
        raise

    def fail(username: str | None) -> HTTPException:
        # Same bookkeeping as a wrong password: the per-IP counter always,
        # the per-username one once the credential names a real account.
        if username is not None:
            session_auth.record_login_failure(db, username, user_exists=True)
        if ip_key is not None:
            session_auth.record_ip_login_failure(db, ip_key, peer_ip)
        return HTTPException(status_code=401, detail="passkey sign-in failed")

    credential_id = _credential_id_of(payload.credential)
    row = (
        db.execute(
            "SELECT p.*, u.username, u.role, u.disabled FROM passkeys p JOIN users u ON u.id = p.user_id "
            "WHERE p.credential_id = ?",
            (credential_id,),
        ).fetchone()
        if credential_id is not None
        else None
    )
    if row is None:
        raise fail(None)
    if session_auth.is_locked_out(db, row["username"], user_exists=True):
        raise HTTPException(
            status_code=429, detail="too many failed attempts, try again later"
        )
    if row["disabled"]:
        raise fail(None)

    handle = payload.credential.get("response", {}).get("userHandle")
    if handle is not None:
        try:
            handle_ok = base64url_to_bytes(handle) == _user_handle(row["user_id"])
        except ValueError:
            handle_ok = False
        if not handle_ok:
            raise fail(row["username"])

    rp_id, origins = _relying_party(request)
    try:
        verified = verify_authentication_response(
            credential=payload.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=bytes(row["public_key"]),
            credential_current_sign_count=row["sign_count"],
            require_user_verification=True,
        )
    except Exception as exc:
        logger.info("passkey sign-in rejected: %s", exc)
        raise fail(row["username"]) from exc

    session_auth.clear_login_failures(db, row["username"])
    db.execute(
        "UPDATE passkeys SET sign_count = ?, last_used_at = datetime('now') WHERE id = ?",
        (verified.new_sign_count, row["id"]),
    )
    db.commit()
    session_auth.start_session(
        db,
        response,
        row["user_id"],
        client=payload.client,
        remember_me=payload.remember_me,
    )
    return AuthUserResponse(username=row["username"], role=row["role"])
