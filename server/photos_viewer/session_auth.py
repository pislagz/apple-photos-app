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
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, BeforeValidator, Field

from . import app_db

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
MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER = MAX_FAILED_LOGIN_ATTEMPTS_PER_IP * 10

_TAILSCALE_USER_LOGIN_HEADER = "tailscale-user-login"
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}
_TRUSTED_PROXIES_ENV = "PHOTOS_VIEWER_TRUSTED_PROXIES"


class _Unset:
    """Sentinel for "not parsed yet", distinct from a legitimately cached
    `None` or empty value -- used by every `PHOTOS_VIEWER_*` cache below."""


_UNSET = _Unset()

_trusted_proxies_cache: list[ipaddress.IPv4Network | ipaddress.IPv6Network] | _Unset = _UNSET


def reset_trusted_proxies_cache() -> None:
    """Test hook: clear the cached parse of `PHOTOS_VIEWER_TRUSTED_PROXIES`,
    so a test that changes the env with `monkeypatch` observes a fresh
    parse instead of a previous test's cached result."""
    global _trusted_proxies_cache
    _trusted_proxies_cache = _UNSET


def _parse_trusted_proxies_env(raw: str) -> tuple[list[ipaddress.IPv4Network | ipaddress.IPv6Network], list[str]]:
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


def set_allowed_tailnet_identities(conn: sqlite3.Connection, identities: Iterable[str]) -> None:
    app_db.set_setting(
        conn, _TAILNET_ALLOWLIST_SETTING_KEY, json.dumps(normalize_tailnet_identities(identities))
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


def _env_seconds(name: str, default_seconds: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default_seconds
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer; using default %d seconds", name, raw, default_seconds)
        return default_seconds
    if value < 0:
        logger.warning("%s=%d is negative; using default %d seconds", name, value, default_seconds)
        return default_seconds
    return value


def _cookie_secure() -> bool:
    """Default true: the cookie is only safe to send over HTTPS (Tailscale
    Serve). Set `PHOTOS_VIEWER_COOKIE_SECURE=false` for local plain-HTTP dev
    only -- never inferred from the request, since a reverse proxy can make
    an HTTP request look however it likes."""
    raw = os.environ.get(_COOKIE_SECURE_ENV, "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def session_lifetime_seconds(client: Literal["desktop", "pwa"], remember_me: bool) -> int:
    if remember_me:
        return _env_seconds(_REMEMBER_ME_LIFETIME_ENV, _DEFAULT_REMEMBER_ME_LIFETIME_SECONDS)
    if client == "pwa":
        return _env_seconds(_PWA_LIFETIME_ENV, _DEFAULT_PWA_LIFETIME_SECONDS)
    return _env_seconds(_DESKTOP_LIFETIME_ENV, _DEFAULT_DESKTOP_LIFETIME_SECONDS)


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
    lifetime_seconds = session_lifetime_seconds(client, remember_me)
    conn.execute(
        "INSERT INTO sessions (id, user_id, device, expires_at, remember_me) "
        "VALUES (?, ?, ?, datetime('now', ?), ?)",
        (_hash_token(raw_token), user_id, device, f"+{lifetime_seconds} seconds", int(remember_me)),
    )
    conn.commit()
    return raw_token, lifetime_seconds


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
        "SELECT sessions.*, users.username AS username, users.role AS role, users.disabled AS disabled "
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


def record_login_failure(conn: sqlite3.Connection, username: str, *, user_exists: bool) -> None:
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


def is_locked_out(conn: sqlite3.Connection, username: str, *, user_exists: bool) -> bool:
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


def record_ip_login_failure(conn: sqlite3.Connection, client_ip: str, peer_ip: str) -> None:
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
    return peer_count >= MAX_FAILED_LOGIN_ATTEMPTS_PER_PEER


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
    return (parsed.scheme.lower(), parsed.hostname.lower(), _effective_port(parsed.scheme, port))


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

    Parsed once and cached: this is called from `_reject_cross_site_requests`
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
        logger.warning("%s: ignoring invalid origin %r (expected scheme://host[:port])", _PUBLIC_ORIGINS_ENV, entry)
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


def _reject_cross_site_requests(request: Request) -> None:
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
    if not content_type.split(";", 1)[0].strip().lower() == "application/json":
        raise HTTPException(status_code=415, detail="Content-Type must be application/json")

    origin = request.headers.get("origin")
    if origin is None:
        return
    parsed_origin = _parse_origin(origin)
    if parsed_origin is None:
        raise HTTPException(status_code=403, detail="cross-origin request rejected")

    allowed = {_request_origin(request)}
    public_origins = _public_origins_from_env()
    if public_origins is not None:
        allowed |= public_origins

    if parsed_origin not in allowed:
        raise HTTPException(status_code=403, detail="cross-origin request rejected")


def _data_dir() -> pathlib.Path:
    return app_db.data_dir_from_env()


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


def _enforce_tailnet_allowlist(request: Request, db: sqlite3.Connection = Depends(get_db)) -> None:
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
        raise HTTPException(status_code=403, detail="tailnet identity not allowed")


def require_session(request: Request, db: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
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


router = APIRouter()


def _normalize_username(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


Username = Annotated[str, BeforeValidator(_normalize_username), Field(min_length=1, max_length=64)]
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


class LoginRequest(BaseModel):
    username: Username
    password: LoginPassword
    remember_me: bool = False
    client: Literal["desktop", "pwa"] = "desktop"


class AuthUserResponse(BaseModel):
    username: str
    role: Literal["admin", "user"]


@router.post(
    "/api/setup/admin",
    status_code=201,
    response_model=AuthUserResponse,
    dependencies=[Depends(_reject_cross_site_requests), Depends(_enforce_tailnet_allowlist)],
)
def setup_admin(payload: AdminSetupRequest, db: sqlite3.Connection = Depends(get_db)) -> AuthUserResponse:
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
            raise HTTPException(status_code=409, detail="first-run setup has already run")
        db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            (payload.username, password_hash),
        )
    except BaseException:
        db.rollback()
        raise
    else:
        db.commit()
    return AuthUserResponse(username=payload.username, role="admin")


@router.post(
    "/api/auth/login",
    response_model=AuthUserResponse,
    dependencies=[Depends(_reject_cross_site_requests), Depends(_enforce_tailnet_allowlist)],
)
def login(payload: LoginRequest, request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)) -> AuthUserResponse:
    _prune_old_login_failures(db)
    peer_ip = _client_ip(request)
    ip_key = _ip_lockout_key(request)

    user = db.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    user_exists = user is not None

    if (ip_key is not None and is_ip_locked_out(db, ip_key, peer_ip)) or is_locked_out(
        db, payload.username, user_exists=user_exists
    ):
        raise HTTPException(status_code=429, detail="too many failed attempts, try again later")

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

    raw_token, max_age = create_session(db, user["id"], client=payload.client, remember_me=payload.remember_me)
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=_cookie_secure(),
        samesite="strict",
        path="/",
    )
    return AuthUserResponse(username=user["username"], role=user["role"])


@router.post("/api/auth/logout", status_code=204, dependencies=[Depends(_reject_cross_site_requests)])
def logout(request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)) -> Response:
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
def read_current_user(session: sqlite3.Row = Depends(require_session)) -> AuthUserResponse:
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
    dependencies=[Depends(_reject_cross_site_requests)],
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
    user = db.execute("SELECT id FROM users WHERE username = ?", (normalized,)).fetchone()
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


@router.get("/api/admin/settings/tailnet-allowlist", response_model=TailnetAllowlistResponse)
def read_tailnet_allowlist(
    admin: sqlite3.Row = Depends(require_admin), db: sqlite3.Connection = Depends(get_db)
) -> TailnetAllowlistResponse:
    return TailnetAllowlistResponse(identities=get_allowed_tailnet_identities(db))


@router.put(
    "/api/admin/settings/tailnet-allowlist",
    response_model=TailnetAllowlistResponse,
    dependencies=[Depends(_reject_cross_site_requests)],
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
