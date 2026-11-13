"""Passwords, session cookies, login lockout, and first-run admin creation.

Named `session_auth.py`, not `auth.py` plus a `tokens.py`/`credentials.py`
pair, because this project's tooling cannot read a path containing "token"
or "credential" (see CLAUDE.md, "Filenames the runner can read").

The cookie value is a random, unguessable string (`secrets.token_urlsafe`),
never a bearer secret shared across users (contrast `photokit-api`, see
`docs/PRIOR_ART.md`). Only its SHA-256 is stored in `app.db`'s `sessions`
table, so a leak of that file alone does not hand out working cookies.

Module docs, referenced from several functions below: this server is meant
to run behind `tailscale serve` (or an equivalent reverse proxy), started
plainly as `uvicorn photos_viewer.main:app`. uvicorn's `--proxy-headers` is
on by default and, also by default, trusts only `127.0.0.1`/`::1` as the
proxy's address (`--forwarded-allow-ips`). Tailscale Serve connects to the
local port from loopback, so with no extra flags uvicorn's own
`ProxyHeadersMiddleware` already rewrites each request's client address
(from `X-Forwarded-For`) and scheme (from `X-Forwarded-Proto`) before any
code in this module runs; it forwards the original `Host` header unchanged,
so the request's URL ends up reading exactly as the public
`https://<machine>.ts.net` origin the browser used. In Docker, the proxy
typically does not connect from loopback (e.g. the Docker bridge gateway
instead), so that rewriting needs `--forwarded-allow-ips` set to the
proxy's actual address, or does not happen at all -- `PHOTOS_VIEWER_PUBLIC_ORIGINS`
is the explicit, proxy-header-independent override for CSRF's Origin check,
and `PHOTOS_VIEWER_TRUSTED_PROXIES` is the equivalent for the per-client
login-lockout bucket (see `_ip_lockout_key`), for an admin who can't set
`--forwarded-allow-ips` to the real proxy address.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import os
import pathlib
import secrets
import sqlite3
import time
from collections.abc import Iterable, Iterator
from typing import Annotated, Literal
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from argon2.low_level import Type
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Request, Response
from pydantic import BaseModel, BeforeValidator, Field

from . import app_db, library_watch

logger = logging.getLogger(__name__)

COOKIE_NAME = "session"

# Lifetimes are configurable (CLAUDE.md / docs/SPEC.md: "long lifetime for
# the installed PWA, shorter for desktop by default"). Settings UI (P1.10)
# will eventually write these into app.db; until then, the environment is
# the configuration surface, read fresh on every call so a test can
# monkeypatch os.environ without reimporting this module.
_DESKTOP_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_DESKTOP_SECONDS"
_PWA_LIFETIME_ENV = "PHOTOS_VIEWER_SESSION_LIFETIME_PWA_SECONDS"
_REMEMBER_ME_LIFETIME_ENV = "PHOTOS_VIEWER_REMEMBER_ME_LIFETIME_SECONDS"
_COOKIE_SECURE_ENV = "PHOTOS_VIEWER_COOKIE_SECURE"

_DEFAULT_DESKTOP_LIFETIME_SECONDS = 12 * 3600
_DEFAULT_PWA_LIFETIME_SECONDS = 30 * 24 * 3600
_DEFAULT_REMEMBER_ME_LIFETIME_SECONDS = 180 * 24 * 3600

# A session is considered idle-refreshed at most once a minute, so a user
# scrolling the grid doesn't turn every request into a write.
_LAST_SEEN_THROTTLE_SECONDS = 60

# Expired-session cleanup is a DELETE plus commit; throttling it to about
# once a minute (module-level, not per-connection) keeps a server under
# constant request load from turning every single request into a write.
# A session past its `expires_at` is already rejected by `lookup_session`'s
# WHERE clause regardless of whether this has run yet -- this only reclaims
# the row.
_SESSION_PRUNE_INTERVAL_SECONDS = 60
_last_session_prune_at = float("-inf")

# Login lockout: a sliding window of recent failures per username, not per
# IP, since several users can share one tailnet address behind Tailscale.
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_WINDOW_SECONDS = 15 * 60

# Looser than the per-username limit: a client hammering many different
# usernames from one address should still be slowed down, but one shared
# tailnet address serving several real users must not lock them all out
# together just because they share an IP. uvicorn's `--proxy-headers`
# (default on, trusting `127.0.0.1`/`::1` by default -- see module docs)
# normally rewrites the per-request client to the real tailnet address
# before this code ever runs; "one address" is only the whole server when
# that rewriting doesn't happen -- see `_ip_lockout_key`.
MAX_FAILED_LOGIN_ATTEMPTS_PER_IP = 30
IP_LOCKOUT_WINDOW_SECONDS = 15 * 60

# Anything that can reach a peer this module trusts to carry
# `Tailscale-User-Login` -- loopback by default, or a `_is_trusted_proxy`
# entry -- can set that header to whatever it likes: a host-level client, a
# LAN client on a published port, or (for loopback) any other process on the
# same machine. Without this, rotating the header would buy a fresh
# MAX_FAILED_LOGIN_ATTEMPTS_PER_IP-try bucket on every attempt. This ceiling
# is deliberately much looser, since it has to cover every real user sharing
# one such peer, not just one: it caps the *sum* of failures across every
# `client_ip` bucket (every header value, plus the peer-IP fallback used when
# a trusted, non-loopback proxy sends no header) that shares one direct peer
# address, loopback included -- see `is_ip_locked_out`.
# Default; `PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER` overrides it (#57), read
# through `max_failed_logins_per_peer()`.
MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER = MAX_FAILED_LOGIN_ATTEMPTS_PER_IP * 10
_PER_PEER_CEILING_ENV = "PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER"

_TAILSCALE_USER_LOGIN_HEADER = "tailscale-user-login"
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}
_TRUSTED_PROXIES_ENV = "PHOTOS_VIEWER_TRUSTED_PROXIES"


class _Unset:
    """Sentinel for "not parsed yet", distinct from a legitimately cached
    `None` or empty value -- used by every `PHOTOS_VIEWER_*` cache below."""


_UNSET = _Unset()

_trusted_proxies_cache: list[ipaddress.IPv4Network | ipaddress.IPv6Network] | _Unset = (
    _UNSET
)


def reset_trusted_proxies_cache() -> None:
    """Test hook: clear the cached parse of `PHOTOS_VIEWER_TRUSTED_PROXIES`,
    so a test that changes the env with `monkeypatch` observes a fresh
    parse instead of a previous test's cached result."""
    global _trusted_proxies_cache
    _trusted_proxies_cache = _UNSET


def _parse_trusted_proxies_env(
    raw: str,
) -> tuple[list[ipaddress.IPv4Network | ipaddress.IPv6Network], list[str]]:
    valid: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    invalid: list[str] = []
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        try:
            valid.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            invalid.append(entry)
    return valid, invalid


def _trusted_proxies() -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """`PHOTOS_VIEWER_TRUSTED_PROXIES`: IPs or CIDRs (comma-separated) of
    reverse proxies this process should treat the same way it already
    treats the loopback peer `tailscale serve` connects from on bare metal
    -- typically the Docker bridge gateway, when `--forwarded-allow-ips`
    isn't (or can't be) pointed at it. A direct client in this list gets
    `_ip_lockout_key`'s loopback treatment: keyed on `Tailscale-User-Login`
    instead of its own (shared-by-everyone-behind-the-proxy) address.

    Parses and validates in one place, regardless of how this is reached:
    directly (e.g. `_is_trusted_proxy`, on the first request) or via
    `validate_trusted_proxies_env` at app startup. Unlike
    `PHOTOS_VIEWER_PUBLIC_ORIGINS`, an invalid entry here is never dropped
    with a warning: a typo'd address or CIDR that silently never matches
    the real proxy would look like it's working right up until the first
    burst of failed logins locks out the whole tailnet, so this raises
    instead -- on whichever call reaches an invalid entry first, not only
    when `validate_trusted_proxies_env` happens to run first.
    """
    global _trusted_proxies_cache
    if _trusted_proxies_cache is _UNSET:
        raw = os.environ.get(_TRUSTED_PROXIES_ENV)
        if raw is None or not raw.strip():
            _trusted_proxies_cache = []
        else:
            valid, invalid = _parse_trusted_proxies_env(raw)
            if invalid:
                raise RuntimeError(
                    f"{_TRUSTED_PROXIES_ENV} has invalid entries "
                    f"(expected an IP address or CIDR, e.g. 172.17.0.1 or 172.18.0.0/16): {invalid!r}"
                )
            _trusted_proxies_cache = valid
    return _trusted_proxies_cache


def validate_trusted_proxies_env() -> None:
    """Called once at app startup, alongside `validate_public_origins_env`,
    so an invalid entry fails startup instead of surfacing on the first
    request that happens to need `_trusted_proxies()`."""
    _trusted_proxies()


def _is_trusted_proxy(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in network for network in _trusted_proxies())


_TAILNET_ALLOWLIST_SETTING_KEY = "allowed_tailnet_identities"


def normalize_tailnet_identities(identities: Iterable[str]) -> list[str]:
    """Strip whitespace, drop empty entries and duplicates, and lower-case --
    stored identities are compared case-insensitively against the
    `Tailscale-User-Login` header, which Tailscale does not guarantee a
    fixed case for."""
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in identities:
        value = raw.strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def get_allowed_tailnet_identities(conn: sqlite3.Connection) -> list[str]:
    """P1.4's optional extra layer (`docs/SPEC.md` line ~116): a list of
    Tailscale identities, empty by default, meaning "no extra restriction"."""
    raw = app_db.get_setting(conn, _TAILNET_ALLOWLIST_SETTING_KEY)
    return json.loads(raw) if raw is not None else []


def set_allowed_tailnet_identities(
    conn: sqlite3.Connection, identities: Iterable[str]
) -> None:
    app_db.set_setting(
        conn,
        _TAILNET_ALLOWLIST_SETTING_KEY,
        json.dumps(normalize_tailnet_identities(identities)),
    )


# Pinned explicitly rather than left at argon2-cffi's defaults, so a future
# library upgrade that changes its defaults can't silently weaken (or just
# change, breaking `check_needs_rehash`) every password in `app.db`.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, type=Type.ID)

# A fixed, valid Argon2 hash with no corresponding real password. Verifying
# against it costs the same as a real verification, so a request for a
# missing or disabled username takes the same time as a wrong password for
# one that exists -- the username can't be inferred from response timing.
_DUMMY_PASSWORD_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True only on an exact match. Never raises -- a malformed stored hash
    or a mismatched password are both just "not authenticated"."""
    try:
        return _hasher.verify(password_hash, password)
    except VerificationError:
        return False


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _env_int(name: str, default: int, unit: str = "") -> int:
    """A non-negative integer from the environment, else `default`; `unit`
    (e.g. " seconds") only decorates the warning text."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not an integer; using default %d%s", name, raw, default, unit
        )
        return default
    if value < 0:
        logger.warning(
            "%s=%d is negative; using default %d%s", name, value, default, unit
        )
        return default
    return value


def _env_seconds(name: str, default_seconds: int) -> int:
    return _env_int(name, default_seconds, " seconds")


def max_failed_logins_per_peer() -> int:
    """The per-peer ceiling: `PHOTOS_VIEWER_MAX_FAILED_LOGINS_PER_PEER` when
    set to a positive integer, else `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`. Read
    on each call, like the session-lifetime variables."""
    value = _env_int(_PER_PEER_CEILING_ENV, MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER)
    if value == 0:
        logger.warning(
            "%s=0 would lock every peer out; using default %d",
            _PER_PEER_CEILING_ENV,
            MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER,
        )
        return MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER
    return value


def _request_is_https(request: Request) -> bool:
    """True when the browser reached us over https. `request.url.scheme` is
    already corrected by uvicorn's proxy-headers handling for its allowed
    proxies; on top of that, `X-Forwarded-Proto` is honoured only when the
    direct peer is loopback or a `PHOTOS_VIEWER_TRUSTED_PROXIES` entry. From
    any other peer the header is client-controlled and ignored."""
    if request.url.scheme.lower() == "https":
        return True
    peer = _client_ip(request)
    if peer in _LOOPBACK_HOSTS or _is_trusted_proxy(peer):
        forwarded = request.headers.get("x-forwarded-proto", "")
        return forwarded.split(",", 1)[0].strip().lower() == "https"
    return False


def _cookie_secure(request: Request | None = None) -> bool:
    """`PHOTOS_VIEWER_COOKIE_SECURE`: `true`/`false` force the flag; unset or
    `auto` (the default) sets `Secure` only when the request arrived over
    https, so plain-http home-network logins work while Tailscale Serve /
    reverse-proxy https installs stay Secure. Without a request (no way to
    tell) it stays Secure."""
    raw = os.environ.get(_COOKIE_SECURE_ENV, "auto").strip().lower()
    if raw in {"0", "false", "no", "off"}:
        return False
    if raw in {"1", "true", "yes", "on"}:
        return True
    if request is None:
        return True
    return _request_is_https(request)


def _setting_or_env_seconds(
    conn: sqlite3.Connection, setting_key: str, env_name: str, default_seconds: int
) -> int:
    """`app.db`'s `settings` table (written by P1.10's Settings screen) wins
    over the environment when a value has been saved there; otherwise this
    falls back to `_env_seconds`, so a server with no Settings save yet
    behaves exactly as it did before P1.10."""
    stored = app_db.get_setting(conn, setting_key)
    if stored is not None:
        try:
            value = int(stored)
        except ValueError:
            value = -1
        if value >= 0:
            return value
    return _env_seconds(env_name, default_seconds)


def session_lifetime_seconds(
    conn: sqlite3.Connection, client: Literal["desktop", "pwa"], remember_me: bool
) -> int:
    if remember_me:
        return _setting_or_env_seconds(
            conn,
            "session_lifetime_remember_me_seconds",
            _REMEMBER_ME_LIFETIME_ENV,
            _DEFAULT_REMEMBER_ME_LIFETIME_SECONDS,
        )
    if client == "pwa":
        return _setting_or_env_seconds(
            conn,
            "session_lifetime_pwa_seconds",
            _PWA_LIFETIME_ENV,
            _DEFAULT_PWA_LIFETIME_SECONDS,
        )
    return _setting_or_env_seconds(
        conn,
        "session_lifetime_desktop_seconds",
        _DESKTOP_LIFETIME_ENV,
        _DEFAULT_DESKTOP_LIFETIME_SECONDS,
    )


def create_session(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    client: Literal["desktop", "pwa"] = "desktop",
    remember_me: bool = False,
    device: str | None = None,
) -> tuple[str, int]:
    """Create a session row and return `(raw_cookie_value, max_age_seconds)`."""
    raw_token = secrets.token_urlsafe(32)
    lifetime_seconds = session_lifetime_seconds(conn, client, remember_me)
    conn.execute(
        "INSERT INTO sessions (id, public_id, user_id, device, expires_at, remember_me) "
        "VALUES (?, ?, ?, ?, datetime('now', ?), ?)",
        (
            _hash_token(raw_token),
            secrets.token_hex(16),
            user_id,
            device,
            f"+{lifetime_seconds} seconds",
            int(remember_me),
        ),
    )
    conn.commit()
    return raw_token, lifetime_seconds


def start_session(
    conn: sqlite3.Connection,
    response: Response,
    user_id: int,
    *,
    request: Request | None = None,
    client: Literal["desktop", "pwa"] = "desktop",
    remember_me: bool = False,
) -> None:
    """Create a session and set its cookie. The one place the cookie flags
    live, so password and passkey sign-in (P3.1) can never drift apart."""
    raw_token, max_age = create_session(
        conn, user_id, client=client, remember_me=remember_me
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="strict",
        path="/",
    )


def _prune_expired_sessions(conn: sqlite3.Connection) -> None:
    global _last_session_prune_at
    now = time.monotonic()
    if now - _last_session_prune_at < _SESSION_PRUNE_INTERVAL_SECONDS:
        return
    _last_session_prune_at = now
    conn.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    conn.commit()


def lookup_session(conn: sqlite3.Connection, raw_token: str) -> sqlite3.Row | None:
    """The session's row, joined with its user, or None if the cookie is
    unknown, expired, or belongs to a now-disabled user."""
    _prune_expired_sessions(conn)
    session_id = _hash_token(raw_token)
    row = conn.execute(
        "SELECT sessions.*, users.username AS username, users.role AS role, users.disabled AS disabled, "
        "users.layout_override AS layout_override "
        "FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.id = ? AND sessions.expires_at > datetime('now')",
        (session_id,),
    ).fetchone()
    if row is None or row["disabled"]:
        return None
    conn.execute(
        "UPDATE sessions SET last_seen_at = datetime('now') "
        "WHERE id = ? AND last_seen_at <= datetime('now', ?)",
        (session_id, f"-{_LAST_SEEN_THROTTLE_SECONDS} seconds"),
    )
    conn.commit()
    return row


def revoke_session(conn: sqlite3.Connection, raw_token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE id = ?", (_hash_token(raw_token),))
    conn.commit()


def revoke_session_by_id(conn: sqlite3.Connection, session_id: str) -> None:
    """Revoke a session by its stored (already-hashed) id -- what an admin's
    Sessions screen (P1.10) lists and revokes, never the raw cookie value."""
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()


def revoke_session_by_public_id(conn: sqlite3.Connection, public_id: str) -> None:
    """Revoke a session by its opaque `public_id` -- what the admin's
    Sessions screen actually lists and revokes by (see `SessionResponse` in
    `admin_panel.py`), never `sessions.id` (the sha256 hash used to look a
    session up from its cookie)."""
    conn.execute("DELETE FROM sessions WHERE public_id = ?", (public_id,))
    conn.commit()


def revoke_sessions_for_user(
    conn: sqlite3.Connection, user_id: int, *, keep_session_id: str | None = None
) -> None:
    """Revoke every session belonging to a user. Called whenever that
    user's password changes (an admin's reset, or their own change) -- a
    stolen or shared cookie from before the change must not keep working.
    `keep_session_id` (a stored, hashed `sessions.id`) spares the session
    that is making the change, so it is not signed out mid-action (#72)."""
    conn.execute(
        "DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?",
        (user_id, keep_session_id),
    )
    conn.commit()


def _prune_old_login_failures(conn: sqlite3.Connection) -> None:
    """Keep both failure tables bounded to their own lockout window. Called
    once per login attempt rather than on a schedule -- cheap, and it means
    an idle server never accumulates rows forever."""
    conn.execute(
        "DELETE FROM login_failures WHERE occurred_at < datetime('now', ?)",
        (f"-{LOCKOUT_WINDOW_SECONDS} seconds",),
    )
    conn.execute(
        "DELETE FROM ip_login_failures WHERE occurred_at < datetime('now', ?)",
        (f"-{IP_LOCKOUT_WINDOW_SECONDS} seconds",),
    )
    conn.commit()


def record_login_failure(
    conn: sqlite3.Connection, username: str, *, user_exists: bool
) -> None:
    """`user_exists` is whether `username` matched a row at the time of this
    attempt, stored alongside the failure so an unknown name's attempts
    never share a counter with a real account's -- see `is_locked_out`."""
    conn.execute(
        "INSERT INTO login_failures (username, user_exists) VALUES (?, ?)",
        (username, int(user_exists)),
    )
    conn.commit()


def clear_login_failures(conn: sqlite3.Connection, username: str) -> None:
    conn.execute("DELETE FROM login_failures WHERE username = ?", (username,))
    conn.commit()


def is_locked_out(
    conn: sqlite3.Connection, username: str, *, user_exists: bool
) -> bool:
    """Trade-off: this lockout is keyed on the username alone, not on who is
    typing it, so someone who merely knows a real username can lock that
    account out for the cool-off window by sending wrong passwords. The
    per-IP limit below is deliberately looser and is not a substitute for
    this -- it exists only to slow down one client guessing many usernames,
    not to protect any one account.

    `user_exists` must match the caller's current knowledge of whether the
    username is real: an unknown name is given the same lockout mechanics
    (so probing it is still slowed down and a 429 doesn't disclose whether
    the account exists), but counted in a separate row set (`user_exists =
    0`), so a flood of guesses against a not-yet-created username can never
    carry over and lock out a real account later created with that name.
    """
    count = conn.execute(
        "SELECT COUNT(*) FROM login_failures "
        "WHERE username = ? AND user_exists = ? AND occurred_at >= datetime('now', ?)",
        (username, int(user_exists), f"-{LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    return count >= MAX_FAILED_LOGIN_ATTEMPTS


def record_ip_login_failure(
    conn: sqlite3.Connection, client_ip: str, peer_ip: str
) -> None:
    """`client_ip` is `_ip_lockout_key`'s bucket (a header value or a raw
    address); `peer_ip` is always the direct TCP peer, so a trusted proxy's
    distinct `client_ip` buckets stay findable as one group by `peer_ip` --
    see `is_ip_locked_out`'s coarse check."""
    conn.execute(
        "INSERT INTO ip_login_failures (client_ip, peer_ip) VALUES (?, ?)",
        (client_ip, peer_ip),
    )
    conn.commit()


def is_ip_locked_out(conn: sqlite3.Connection, client_ip: str, peer_ip: str) -> bool:
    """True once either the fine-grained `client_ip` bucket, or the coarse
    ceiling across every bucket sharing `peer_ip` (see
    `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`), has tripped. For a direct,
    non-loopback, non-trusted-proxy caller `client_ip == peer_ip`, so the
    coarse check is counting the same rows the fine one already did and
    never trips first. A loopback or trusted-proxy caller using the
    `Tailscale-User-Login`-keyed bucket (see `_ip_lockout_key`) is where the
    two differ: `peer_ip` is the one shared address, so the coarse ceiling
    is what catches header rotation across many such callers."""
    count = conn.execute(
        "SELECT COUNT(*) FROM ip_login_failures "
        "WHERE client_ip = ? AND occurred_at >= datetime('now', ?)",
        (client_ip, f"-{IP_LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    if count >= MAX_FAILED_LOGIN_ATTEMPTS_PER_IP:
        return True
    peer_count = conn.execute(
        "SELECT COUNT(*) FROM ip_login_failures "
        "WHERE peer_ip = ? AND occurred_at >= datetime('now', ?)",
        (peer_ip, f"-{IP_LOCKOUT_WINDOW_SECONDS} seconds"),
    ).fetchone()[0]
    return peer_count >= max_failed_logins_per_peer()


def clear_ip_login_failures(conn: sqlite3.Connection) -> None:
    """Clear every per-client counter, not just one -- there is no per-IP
    username to scope this to (see `_ip_lockout_key`)."""
    conn.execute("DELETE FROM ip_login_failures")
    conn.commit()


def _client_ip(request: Request) -> str:
    client = request.client
    return client.host if client is not None else "unknown"


def _ip_lockout_key(request: Request) -> str | None:
    """Key for the per-client failed-login counter, or None to skip it
    entirely for this request.

    With uvicorn's `--proxy-headers` trusting the proxy (the default --
    see module docs), `request.client` is already the real tailnet address
    by the time this runs, so keying on it tells callers apart correctly.
    The loopback case below only matters when that rewriting didn't happen
    (proxy headers disabled, or the proxy's address isn't in
    `--forwarded-allow-ips`, e.g. a Docker bridge gateway by default): then
    every request looks like it comes from the one address the proxy
    connects from, and keying on it would turn a handful of wrong passwords
    from one real user into a lockout for everyone behind it. In that case,
    key on the `Tailscale-User-Login` header Tailscale Serve adds instead.
    That header-keyed bucket is still, deliberately, subject to
    `MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER`'s coarse ceiling (see
    `is_ip_locked_out`): every such bucket shares loopback's one `peer_ip`,
    and anything else on the same host can set its own
    `Tailscale-User-Login` value too (issue #22 A) -- the ceiling is what
    stops that from buying unlimited tries the same way it does for a
    trusted proxy below. `PHOTOS_VIEWER_TRUSTED_PROXIES` extends that same
    loopback treatment to other known-safe peers -- typically the Docker
    bridge gateway, when `--forwarded-allow-ips` can't be pointed at it
    directly. With no such header, a bare loopback peer can't be
    distinguished from any other caller behind it, so the per-client limit
    is skipped for this request (the per-username lockout above still
    applies regardless). A configured `PHOTOS_VIEWER_TRUSTED_PROXIES` entry
    is different: unlike loopback, it can be reached by more than the proxy
    itself (issue #20 A), so instead of skipping the limit outright, it
    falls back to the peer's own address as the bucket -- still subject to
    the same coarse ceiling if that address also happens to be shared by
    header-bearing callers.
    """
    host = _client_ip(request)
    trusted_proxy = _is_trusted_proxy(host)
    if host not in _LOOPBACK_HOSTS and not trusted_proxy:
        return host
    login = request.headers.get(_TAILSCALE_USER_LOGIN_HEADER)
    if login:
        return f"tailscale-user:{login}"
    return host if trusted_proxy else None


_DEFAULT_PORTS = {"http": 80, "https": 443}

_PUBLIC_ORIGINS_ENV = "PHOTOS_VIEWER_PUBLIC_ORIGINS"

# Origin tuple: (scheme, hostname, effective port). Ports are normalized to
# the scheme's default (80/443) so "https://x.ts.net" and
# "https://x.ts.net:443" compare equal.
_Origin = tuple[str, str, int | None]


def _effective_port(scheme: str, port: int | None) -> int | None:
    return port if port is not None else _DEFAULT_PORTS.get(scheme.lower())


_ALLOWED_ORIGIN_SCHEMES = {"http", "https"}


def _parse_origin(origin: str) -> _Origin | None:
    """Parse a bare `scheme://host[:port]` origin -- from an `Origin` header
    or a `PHOTOS_VIEWER_PUBLIC_ORIGINS` entry -- into the `(scheme, host,
    port)` tuple `_request_origin` compares against.

    Only `http`/`https` and a bare origin are accepted: a path other than
    "" or "/", a query, or a fragment aren't part of an origin, and
    silently dropping them would compare against the wrong thing instead
    of rejecting. `parsed.port` raises `ValueError` on a non-numeric port
    (e.g. `https://box.ts.net:abc`); that's just an invalid origin too, not
    a crash.
    """
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme.lower() not in _ALLOWED_ORIGIN_SCHEMES or not parsed.hostname:
        return None
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        return None
    return (
        parsed.scheme.lower(),
        parsed.hostname.lower(),
        _effective_port(parsed.scheme, port),
    )


def _request_origin(request: Request) -> _Origin:
    return (
        request.url.scheme.lower(),
        (request.url.hostname or "").lower(),
        _effective_port(request.url.scheme, request.url.port),
    )


def _split_public_origins_env(raw: str) -> tuple[set[_Origin], list[str]]:
    """Parse `PHOTOS_VIEWER_PUBLIC_ORIGINS`'s comma-separated value into the
    origins that parsed and the raw entries (e.g. `box.ts.net`, missing its
    `https://`) that didn't."""
    valid: set[_Origin] = set()
    invalid: list[str] = []
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        parsed = _parse_origin(entry)
        if parsed is None:
            invalid.append(entry)
        else:
            valid.add(parsed)
    return valid, invalid


_public_origins_cache: set[_Origin] | None | _Unset = _UNSET


def reset_public_origins_cache() -> None:
    """Test hook: clear the cached parse of `PHOTOS_VIEWER_PUBLIC_ORIGINS`,
    so a test that changes the env with `monkeypatch` observes a fresh
    parse (and fresh warnings) instead of a previous test's cached result."""
    global _public_origins_cache
    _public_origins_cache = _UNSET


def _ensure_logger_has_a_handler() -> None:
    """uvicorn configures its own loggers but never attaches a handler to
    the root logger, so a bare `logger.warning(...)` has nowhere to go and
    is easy to miss -- *unless* something else already configured the root
    logger (e.g. uvicorn's own `--log-config`, or the host app's logging
    setup), in which case this module's record already reaches a handler
    via propagation, and adding a second one here would print it twice.

    So: `Logger.hasHandlers()` walks the same chain (following `propagate`)
    that logging itself would when dispatching a record, and only attach a
    handler, and only force `WARNING`, if nothing in that chain -- this
    logger included -- has one. An explicitly configured level anywhere in
    the chain is left alone either way; this never raises or lowers one.
    """
    if logger.hasHandlers():
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)


def _public_origins_from_env() -> set[_Origin] | None:
    """`PHOTOS_VIEWER_PUBLIC_ORIGINS`: the exact origin(s) this server is
    reachable at from a browser's point of view (e.g. the `ts.net` name
    `tailscale serve` exposes), comma-separated. Unset by default, since a
    bare-metal or Docker install with no reverse proxy needs nothing extra.

    Parsed once and cached: this is called from `reject_cross_site_requests`
    on every state-changing request, and re-parsing (and re-warning about
    the same invalid entry) on each one would be both wasted work and log
    spam. `validate_public_origins_env`, called once at app startup,
    populates the cache -- and is what refuses to start the app if an
    invalid entry leaves nothing valid -- so in practice this only parses
    once, at startup, not on first request.
    """
    global _public_origins_cache
    if _public_origins_cache is not _UNSET:
        return _public_origins_cache
    raw = os.environ.get(_PUBLIC_ORIGINS_ENV)
    if raw is None or not raw.strip():
        _public_origins_cache = None
        return None
    valid, invalid = _split_public_origins_env(raw)
    if invalid:
        _ensure_logger_has_a_handler()
    for entry in invalid:
        logger.warning(
            "%s: ignoring invalid origin %r (expected scheme://host[:port])",
            _PUBLIC_ORIGINS_ENV,
            entry,
        )
    _public_origins_cache = valid
    return valid


def validate_public_origins_env() -> None:
    """Called once at app startup. A `PHOTOS_VIEWER_PUBLIC_ORIGINS` that is
    set but parses to nothing is indistinguishable, from the CSRF check's
    point of view, from it being unset -- except that the admin thinks
    they've configured the override. Fail loudly instead of falling back to
    same-origin-only checking silently.
    """
    raw = os.environ.get(_PUBLIC_ORIGINS_ENV)
    if raw is None or not raw.strip():
        return
    valid, invalid = _split_public_origins_env(raw)
    if invalid and not valid:
        raise RuntimeError(
            f"{_PUBLIC_ORIGINS_ENV} is set but every entry is invalid "
            f"(expected scheme://host[:port], e.g. https://box.ts.net): {invalid!r}"
        )
    _public_origins_from_env()  # parse (and warn about any invalid entries) now, at startup


def _origin_matches_host_header(origin: _Origin, request: Request) -> bool:
    """Same-host check: the Origin's host and port equal the Host header the
    browser sent. The Origin header is set by the browser and can't be forged
    by a page on another site, so a cross-site page never matches (its Origin
    names its own host, not ours). This is what lets
    http://192.168.1.20:8000 or http://homeserver.local:8000 sign in with no
    configured origin list. The scheme must equal the scheme the request
    actually arrived with (`request.url.scheme`, which uvicorn corrects only
    for trusted proxies): a same-host Origin with the other scheme is
    rejected, and an untrusted peer's `X-Forwarded-Proto` never counts. A
    TLS-terminating proxy that doesn't forward the scheme needs
    `PHOTOS_VIEWER_PUBLIC_ORIGINS`."""
    scheme, hostname, port = origin
    if scheme != request.url.scheme.lower():
        return False
    host_header = request.headers.get("host", "").strip().lower()
    if not host_header:
        return False
    parsed = _parse_origin(f"{scheme}://{host_header}")
    if parsed is None:
        return False
    return parsed[1] == hostname and parsed[2] == port


def reject_cross_site_requests(request: Request) -> None:
    """CSRF defense for every state-changing (POST) route, including logout.

    A browser form (the classic CSRF vector) cannot set an arbitrary
    `Content-Type`, only a handful of "simple" values that exclude
    `application/json` -- requiring it blocks that vector outright. The
    `Origin` check is a second layer for clients that can set headers (e.g.
    a `fetch` from another site); a same-origin or absent Origin is allowed,
    since same-origin requests and some non-browser clients don't send one.

    "Same-origin" is not simply "this process's own loopback socket": behind
    `tailscale serve`, the browser's Origin is the tailnet `ts.net` name
    over https. uvicorn's `--proxy-headers` (on by default, trusting
    `127.0.0.1`/`::1` by default -- see module docs) already rewrites
    `request.url.scheme` from `X-Forwarded-Proto` before this code runs, and
    `tailscale serve` forwards the original Host header unchanged, so
    `request.url` already reads as that same public origin with no extra
    header-parsing needed here. `PHOTOS_VIEWER_PUBLIC_ORIGINS` is the
    explicit override for setups where that rewriting doesn't happen (proxy
    headers disabled, or the proxy's address isn't in
    `--forwarded-allow-ips`, e.g. a Docker bridge gateway by default).
    """
    content_type = request.headers.get("content-type", "")
    # A bare DELETE has no body, so no client sends a Content-Type for it. A
    # cross-site form can't issue DELETE at all, so the Origin check below
    # is the whole guard for that case. "Body-less" is judged by a missing or
    # zero Content-Length (no Transfer-Encoding); that is only safe because a
    # cross-site DELETE needs a CORS preflight we never grant and the Origin
    # check below still runs for every such request.
    bodyless_delete = (
        request.method == "DELETE"
        and request.headers.get("content-length", "0") == "0"
        and "transfer-encoding" not in request.headers
    )
    if (
        not bodyless_delete
        and content_type.split(";", 1)[0].strip().lower() != "application/json"
    ):
        raise HTTPException(
            status_code=415, detail="Content-Type must be application/json"
        )

    origin = request.headers.get("origin")
    if origin is None:
        return
    parsed_origin = _parse_origin(origin)
    if parsed_origin is None:
        raise HTTPException(status_code=403, detail="cross-origin request rejected")

    if _origin_matches_host_header(parsed_origin, request):
        return

    allowed = {_request_origin(request)}
    public_origins = _public_origins_from_env()
    if public_origins is not None:
        allowed |= public_origins

    if parsed_origin not in allowed:
        raise HTTPException(status_code=403, detail="cross-origin request rejected")


def _data_dir() -> pathlib.Path:
    return app_db.data_dir_from_env()


def get_data_dir() -> pathlib.Path:
    """Where `app.db` lives. A dependency, like `get_db` below, so a
    background indexing job (P1.12A) can open its own connection at the
    same path the request used -- tests override this to `tmp_path`
    exactly as they already do for `get_db`/`get_media_cache_dir`, instead
    of `$PHOTOS_VIEWER_DATA_DIR` or `./data`.

    A background job cannot simply reuse the request's `get_db` connection:
    FastAPI tears that one down (its `finally: conn.close()`) before a
    `BackgroundTasks` callback runs, and in production each request gets a
    fresh connection it would be unsafe to hand to a job that outlives the
    request.
    """
    return _data_dir()


def get_media_cache_dir() -> pathlib.Path:
    """Where P1.9's thumb/original routes ask `media.get_or_generate()` to
    cache generated images. A dependency, like `get_db` below, so tests can
    override it to a `tmp_path` instead of touching `$PHOTOS_VIEWER_DATA_DIR`
    or `./data`."""
    return app_db.media_cache_dir(_data_dir())


def get_db() -> Iterator[sqlite3.Connection]:
    """Request-scoped `app.db` connection. Tests override this dependency
    with one pointed at `tmp_path`, so the default (`$PHOTOS_VIEWER_DATA_DIR`,
    or `./data`) is never touched by the test suite."""
    conn = app_db.connect(_data_dir())
    try:
        yield conn
    finally:
        conn.close()


def _trusted_tailscale_user_login(request: Request) -> str | None:
    """The `Tailscale-User-Login` header, but only when it could actually
    have been set by `tailscale serve` -- i.e. the direct peer is loopback
    or a configured `PHOTOS_VIEWER_TRUSTED_PROXIES` entry, the same trust
    boundary `_ip_lockout_key` uses (see its docstring and CLAUDE.md). A
    header from any other peer is ignored outright, not just distrusted for
    lockout accounting: otherwise any LAN client reaching this port could
    set the header itself and walk straight through the allow-list below.
    """
    host = _client_ip(request)
    if host not in _LOOPBACK_HOSTS and not _is_trusted_proxy(host):
        return None
    return request.headers.get(_TAILSCALE_USER_LOGIN_HEADER)


def _enforce_tailnet_allowlist(
    request: Request, db: sqlite3.Connection = Depends(get_db)
) -> None:
    """FastAPI dependency: 403 unless the caller's trusted
    `Tailscale-User-Login` header is in the configured allow-list. A no-op
    when the list is empty (the default) -- this is an *optional* extra
    layer, not a replacement for the session cookie. Used alongside
    `require_session` (via `require_session` itself) and explicitly on
    login and first-run setup, which run before a session exists."""
    allowed = get_allowed_tailnet_identities(db)
    if not allowed:
        return
    login = _trusted_tailscale_user_login(request)
    if login is None or login.strip().lower() not in allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "tailnet_identity_not_allowed",
                "message": "tailnet identity not allowed",
            },
        )


def require_session(
    request: Request, db: sqlite3.Connection = Depends(get_db)
) -> sqlite3.Row:
    """FastAPI dependency: the caller's session row, or 401. Use on every
    route that needs "who is asking" -- the P1.8 per-library assignment
    guard builds on top of this. Also enforces the P1.4 tailnet allow-list,
    so every route built on this one gets it for free."""
    _enforce_tailnet_allowlist(request, db)
    raw_token = request.cookies.get(COOKIE_NAME)
    session = lookup_session(db, raw_token) if raw_token else None
    if session is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return session


def require_admin(session: sqlite3.Row = Depends(require_session)) -> sqlite3.Row:
    """FastAPI dependency: the caller's session row, or 403 if it is not an
    admin's. Use on every `/api/admin/*` route."""
    if session["role"] != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return session


def require_library_assignment(
    library_id: int = Path(...),
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> sqlite3.Row:
    """FastAPI dependency for every `/api/libraries/{library_id}/...` route:
    the library row, or 404.

    `library_id` is pinned to `Path(...)` on purpose: without it, FastAPI
    infers the parameter's location from whether a route's path template
    happens to contain a `{library_id}` segment -- so a route written as
    `/api/libraries/{lib}/...` (the wrong name) would silently read
    `library_id` from the *query string* instead, while the handler still
    serves whatever library id is in the path. `Path(...)` forces this
    dependency to always bind from the path, so that route either 422s (no
    `library_id` path segment exists to bind from) instead of leaking
    another library through a query-string override, or -- the case CI
    actually catches -- gets flagged by `unguarded_library_routes()` below,
    which checks the literal `{library_id}` spelling.

    One query, joining `libraries` to `library_assignments` for this
    caller, so "the library doesn't exist" and "it exists but isn't
    assigned to you" are indistinguishable -- same status, same query shape
    -- including for an admin who hasn't assigned the library to themselves
    (CLAUDE.md's access-control scenario: admin routes are 403 for a
    non-admin, but *this* guard treats an admin like anyone else, since
    `library_assignments` has no admin-bypass row). See CLAUDE.md, "Foreign
    library and asset ids return 404", for why this isn't a 403.
    """
    row = db.execute(
        "SELECT libraries.* FROM libraries "
        "JOIN library_assignments ON library_assignments.library_id = libraries.id "
        "WHERE libraries.id = ? AND library_assignments.user_id = ?",
        (library_id, session["user_id"]),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    # P1.22: a missing, copying or not-yet-valid package is "Being updated".
    # Checked after the assignment join so a foreign library still 404s.
    updating, reason = library_watch.public_availability(row)
    if updating:
        raise HTTPException(
            status_code=503, detail={"code": "library_updating", "message": reason}
        )
    return row


LIBRARY_ROUTE_PATH_PREFIX = "/api/libraries/{"


def _dependency_closure(dependant: object) -> set[object]:
    """Every dependency callable reachable from a route's `Dependant`,
    including itself and each dependency's own dependencies, recursively --
    so the guard is found whether a route depends on it directly or through
    another dependency that itself depends on it."""
    seen: set[object] = set()
    stack = [dependant]
    while stack:
        current = stack.pop()
        call = getattr(current, "call", None)
        if call is None or call in seen:
            continue
        seen.add(call)
        stack.extend(getattr(current, "dependencies", []))
    return seen


def leaf_routes(routes: object) -> list[object]:
    """Resolve FastAPI's lazy router-inclusion wrappers into the routes they
    stand for. Since FastAPI's `app.include_router(...)` stopped eagerly
    flattening included routes into `app.routes`, a route added through
    `include_router` -- the pattern every router in this app uses -- only
    exposes its real `path`/`dependant` through an `effective_candidates()`
    call, and a router included inside another router needs the same
    resolution applied again."""
    leaves = []
    for route in routes:
        effective_candidates = getattr(route, "effective_candidates", None)
        if callable(effective_candidates):
            leaves.extend(leaf_routes(effective_candidates()))
        else:
            leaves.append(route)
    return leaves


def unguarded_library_routes(app: FastAPI) -> list[str]:
    """Every registered route whose path starts with `/api/libraries/{` that
    either does not spell its path parameter `{library_id}` or does not
    depend on `require_library_assignment`, directly or transitively.
    Empty is the only passing result.

    A route written as `/api/libraries/{lib}/...` would still formally
    depend on `require_library_assignment` (the dependency closure check
    alone would miss it), but `require_library_assignment`'s `Path(...)`
    binding has nothing named `library_id` to read from that path -- the
    route either 422s or, pre-fix, fell back to a query-string
    `library_id` while the handler kept serving whatever library `{lib}`
    pointed to. The literal-spelling check below catches that misnamed
    route regardless of which of those two things it would have done, so a
    new library route that forgets the guard, or spells its path parameter
    wrong, cannot serve one user's library to another.

    The spelling check compares the whole path *segment*, not just a
    string prefix: `/api/libraries/{library_id}x/...` starts with the same
    characters as a correctly-spelled route, so a plain `startswith` would
    miss it entirely -- its first segment is `{library_id}x`, not
    `{library_id}`."""
    violations = []
    for route in leaf_routes(app.routes):
        path = getattr(route, "path", "")
        if not path.startswith(LIBRARY_ROUTE_PATH_PREFIX):
            continue
        # ["", "api", "libraries", "{library_id}", ...] -- segment [3] is
        # the one that must spell `{library_id}` exactly, not merely start
        # with it (a plain `startswith` would also match `{library_id}x`).
        if path.split("/")[3] != "{library_id}":
            violations.append(path)
            continue
        dependant = getattr(route, "dependant", None)
        if dependant is None or require_library_assignment not in _dependency_closure(
            dependant
        ):
            violations.append(path)
    return violations


router = APIRouter()


def _normalize_username(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


Username = Annotated[
    str, BeforeValidator(_normalize_username), Field(min_length=1, max_length=64)
]
Password = Annotated[str, Field(min_length=12, max_length=1024)]
# Login must not apply the 12-character minimum: a short wrong password has
# to go through the same lockout accounting and Argon2 verify as any other
# wrong password, not get turned away early by validation (which would also
# make a 422-vs-401 split another way to probe password length). The
# minimum still applies at setup and user creation, via `Password` above.
LoginPassword = Annotated[str, Field(max_length=1024)]


class AdminSetupRequest(BaseModel):
    username: Username
    password: Password
    # "Map & place names": off unless the admin agrees at first run.
    osm_consent: bool = False


class LoginRequest(BaseModel):
    username: Username
    password: LoginPassword
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


class AuthUserResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]


class SetupStatusResponse(BaseModel):
    needs_setup: bool


@router.get(
    "/api/setup/status",
    response_model=SetupStatusResponse,
    dependencies=[Depends(_enforce_tailnet_allowlist)],
)
def setup_status(db: sqlite3.Connection = Depends(get_db)) -> SetupStatusResponse:
    """Whether `POST /api/setup/admin` is still open, so the web app can show
    "Create admin account" instead of "Sign in" before any user row exists."""
    (existing_users,) = db.execute("SELECT COUNT(*) FROM users").fetchone()
    return SetupStatusResponse(needs_setup=existing_users == 0)


@router.post(
    "/api/setup/admin",
    status_code=201,
    response_model=AuthUserResponse,
    dependencies=[
        Depends(reject_cross_site_requests),
        Depends(_enforce_tailnet_allowlist),
    ],
)
def setup_admin(
    payload: AdminSetupRequest, db: sqlite3.Connection = Depends(get_db)
) -> AuthUserResponse:
    """Create the single admin account. Disables itself the moment any user
    row exists, so it cannot be used again to add a second account.

    The count-then-insert is one `BEGIN IMMEDIATE` transaction: IMMEDIATE
    takes SQLite's write lock before the SELECT, so if two first-run
    requests race, the second blocks until the first commits and then sees
    a non-zero count instead of also inserting a second admin.
    """
    password_hash = hash_password(payload.password)  # hash before taking the write lock
    db.execute("BEGIN IMMEDIATE")
    try:
        (existing_users,) = db.execute("SELECT COUNT(*) FROM users").fetchone()
        if existing_users > 0:
            raise HTTPException(
                status_code=409, detail="first-run setup has already run"
            )
        db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (payload.username, password_hash),
        )
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (app_db.OSM_CONSENT_KEY, "1" if payload.osm_consent else "0"),
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()
    if payload.osm_consent:
        app_db.write_audit_log(
            db,
            "osm_consent_agreed",
            actor=payload.username,
            detail="Map & place names (first-run setup)",
        )
    return AuthUserResponse(username=payload.username, role="admin")


@router.post(
    "/api/auth/login",
    response_model=AuthUserResponse,
    dependencies=[
        Depends(reject_cross_site_requests),
        Depends(_enforce_tailnet_allowlist),
    ],
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
) -> AuthUserResponse:
    _prune_old_login_failures(db)
    peer_ip = _client_ip(request)
    ip_key = _ip_lockout_key(request)

    user = db.execute(
        "SELECT * FROM users WHERE username = ?", (payload.username,)
    ).fetchone()
    user_exists = user is not None

    if (ip_key is not None and is_ip_locked_out(db, ip_key, peer_ip)) or is_locked_out(
        db, payload.username, user_exists=user_exists
    ):
        raise HTTPException(
            status_code=429, detail="too many failed attempts, try again later"
        )

    if user is None or user["disabled"]:
        # Always verify against something, even for a missing or disabled
        # user, so the response takes the same time either way and a
        # username can't be inferred from how fast it failed.
        verify_password(_DUMMY_PASSWORD_HASH, payload.password)
        password_ok = False
    else:
        password_ok = verify_password(user["password_hash"], payload.password)

    if not password_ok:
        record_login_failure(db, payload.username, user_exists=user_exists)
        if ip_key is not None:
            record_ip_login_failure(db, ip_key, peer_ip)
        raise HTTPException(status_code=401, detail="invalid username or password")

    clear_login_failures(db, payload.username)
    if _hasher.check_needs_rehash(user["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(payload.password), user["id"]),
        )
        db.commit()

    start_session(
        db,
        response,
        user["id"],
        request=request,
        client=payload.client,
        remember_me=payload.remember_me,
    )
    return AuthUserResponse(username=user["username"], role=user["role"])


HIDDEN_UNLOCK_SECONDS = 300


class ReconfirmPasswordRequest(BaseModel):
    password: LoginPassword


@router.post(
    "/api/auth/reconfirm-password",
    status_code=204,
    dependencies=[Depends(reject_cross_site_requests)],
)
def reconfirm_password(
    payload: ReconfirmPasswordRequest,
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """#130: re-ask for the signed-in user's own password before Hidden opens.

    Checks against the current user's hash only; it never creates or replaces
    a session. Shares the login lockout counters, so guessing here is
    rate-limited like guessing at login. Success marks this session as
    Hidden-unlocked for a short sliding window (see `hidden_is_unlocked`).
    """
    username = session["username"]
    _prune_old_login_failures(db)
    if is_locked_out(db, username, user_exists=True):
        raise HTTPException(
            status_code=429, detail="too many failed attempts, try again later"
        )
    user = db.execute(
        "SELECT password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    if user is None or not verify_password(user["password_hash"], payload.password):
        record_login_failure(db, username, user_exists=True)
        raise HTTPException(status_code=401, detail="wrong password")
    clear_login_failures(db, username)
    db.execute(
        "UPDATE sessions SET hidden_unlocked_until = datetime('now', ?) WHERE id = ?",
        (f"+{HIDDEN_UNLOCK_SECONDS} seconds", session["id"]),
    )
    db.commit()
    return Response(status_code=204)


class ChangePasswordRequest(BaseModel):
    current_password: LoginPassword
    new_password: Password


@router.post(
    "/api/auth/change-password",
    status_code=204,
    dependencies=[Depends(reject_cross_site_requests)],
)
def change_password(
    payload: ChangePasswordRequest,
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """#71: a signed-in user changes their own password. The current password
    is re-checked (and shares the login lockout counters, like
    `reconfirm_password`), every *other* session of the user is revoked so a
    stolen or shared cookie dies with the old password, and the session making
    the request stays signed in."""
    username = session["username"]
    _prune_old_login_failures(db)
    if is_locked_out(db, username, user_exists=True):
        raise HTTPException(
            status_code=429, detail="too many failed attempts, try again later"
        )
    user = db.execute(
        "SELECT id, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    if user is None or not verify_password(
        user["password_hash"], payload.current_password
    ):
        record_login_failure(db, username, user_exists=True)
        raise HTTPException(status_code=401, detail="wrong password")
    clear_login_failures(db, username)
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(payload.new_password), user["id"]),
    )
    db.commit()
    revoke_sessions_for_user(db, user["id"], keep_session_id=session["id"])
    app_db.write_audit_log(
        db, "change_password", user_id=user["id"], actor=username, detail="self-service"
    )
    return Response(status_code=204)


@router.post(
    "/api/auth/lock-hidden",
    status_code=204,
    dependencies=[Depends(reject_cross_site_requests)],
)
def lock_hidden(
    session: sqlite3.Row = Depends(require_session),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    """Re-lock Hidden for this session (the client calls this on leaving it)."""
    db.execute(
        "UPDATE sessions SET hidden_unlocked_until = NULL WHERE id = ?",
        (session["id"],),
    )
    db.commit()
    return Response(status_code=204)


def require_hidden_unlocked(session: sqlite3.Row, db: sqlite3.Connection) -> None:
    """403 `hidden_locked` unless a recent reconfirm unlocked this session.
    Allowed calls slide the window forward so paging through Hidden does
    not re-prompt mid-browse. The slide is only written once less than half
    the window is left: hidden thumbnails/originals also call this (#151),
    and a DB write per image request would serialise a whole grid of
    thumbnail loads on SQLite's write lock."""
    row = db.execute(
        "SELECT hidden_unlocked_until > datetime('now') AS unlocked,"
        " hidden_unlocked_until < datetime('now', ?) AS stale"
        " FROM sessions WHERE id = ?",
        (f"+{HIDDEN_UNLOCK_SECONDS // 2} seconds", session["id"]),
    ).fetchone()
    if row is None or not row["unlocked"]:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "hidden_locked",
                "message": "password required to open Hidden",
            },
        )
    if row["stale"]:
        db.execute(
            "UPDATE sessions SET hidden_unlocked_until = datetime('now', ?) WHERE id = ?",
            (f"+{HIDDEN_UNLOCK_SECONDS} seconds", session["id"]),
        )
        db.commit()


@router.post(
    "/api/auth/logout",
    status_code=204,
    dependencies=[Depends(reject_cross_site_requests)],
)
def logout(
    request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)
) -> Response:
    raw_token = request.cookies.get(COOKIE_NAME)
    if raw_token:
        revoke_session(db, raw_token)
    # Mutate and return the injected `response`, not a fresh one -- a route
    # that returns a brand-new Response object instead replaces FastAPI's
    # injected one outright, dropping the delete_cookie header set on it.
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response


@router.get("/api/auth/me", response_model=AuthUserResponse)
def read_current_user(
    session: sqlite3.Row = Depends(require_session),
) -> AuthUserResponse:
    return AuthUserResponse(username=session["username"], role=session["role"])


class UnlockRequest(BaseModel):
    # Mirrors the CLI's `--clear-ip-limits` (see `admin.py`): also clear the
    # shared per-client counter, not just this one username's.
    clear_ip_limits: bool = False


class UnlockResponse(BaseModel):
    username: str


@router.post(
    "/api/admin/users/{username}/unlock",
    response_model=UnlockResponse,
    dependencies=[Depends(reject_cross_site_requests)],
)
def unlock_user(
    username: str,
    payload: UnlockRequest | None = None,
    admin: sqlite3.Row = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
) -> UnlockResponse:
    """Clear a username's lockout counter. The P1.10 admin UI doesn't exist
    yet; this is the API it will call for its "Unlock" action."""
    payload = payload or UnlockRequest()
    normalized = _normalize_username(username)
    user = db.execute(
        "SELECT id FROM users WHERE username = ?", (normalized,)
    ).fetchone()
    if user is None:
        raise HTTPException(status_code=404, detail="not found")
    clear_login_failures(db, normalized)
    if payload.clear_ip_limits:
        clear_ip_login_failures(db)
    app_db.write_audit_log(
        db,
        "unlock_user",
        user_id=user["id"],
        actor=admin["username"],
        detail=f"ip_limits_cleared={'true' if payload.clear_ip_limits else 'false'}",
    )
    return UnlockResponse(username=normalized)


class TailnetAllowlistResponse(BaseModel):
    identities: list[str]


class TailnetAllowlistRequest(BaseModel):
    identities: list[str]


@router.get(
    "/api/admin/settings/tailnet-allowlist", response_model=TailnetAllowlistResponse
)
def read_tailnet_allowlist(
    admin: sqlite3.Row = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
) -> TailnetAllowlistResponse:
    return TailnetAllowlistResponse(identities=get_allowed_tailnet_identities(db))


@router.put(
    "/api/admin/settings/tailnet-allowlist",
    response_model=TailnetAllowlistResponse,
    dependencies=[Depends(reject_cross_site_requests)],
)
def write_tailnet_allowlist(
    payload: TailnetAllowlistRequest,
    request: Request,
    admin: sqlite3.Row = Depends(require_admin),
    db: sqlite3.Connection = Depends(get_db),
) -> TailnetAllowlistResponse:
    """Admin-only, API-only for now (P1.10's admin UI will add a form for
    this). Setting a non-empty list takes effect immediately, including for
    the admin's own next request -- see `_enforce_tailnet_allowlist`. Issue
    #26: a non-empty list that would lock the caller themselves out is
    refused outright, since the only recovery from that is the CLI's
    `allowlist clear` run inside the container (see `admin.py`)."""
    normalized = normalize_tailnet_identities(payload.identities)
    if normalized:
        caller = _trusted_tailscale_user_login(request)
        if caller is None or caller.strip().lower() not in normalized:
            raise HTTPException(
                status_code=400,
                detail="allow-list must include your own tailnet identity, or you would be locked out",
            )
    set_allowed_tailnet_identities(db, normalized)
    app_db.write_audit_log(
        db,
        "set_tailnet_allowlist",
        actor=admin["username"],
        detail=f"count={len(normalized)}",
    )
    return TailnetAllowlistResponse(identities=get_allowed_tailnet_identities(db))
