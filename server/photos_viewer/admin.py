"""CLI for operations that must work without a running server.

The motivating case (issue #12): an admin locked out of their own account
behind `tailscale serve` has no way to call the `/api/admin/*` unlock route,
since that route itself requires a session. This works directly on `app.db`
under `PHOTOS_VIEWER_DATA_DIR`, so it also works inside the Docker/OrbStack
container with no server running:

    docker exec <container> python -m photos_viewer.admin unlock <username>

Issue #26: the same problem applies to the P1.4 tailnet allow-list -- an
admin who saves a list that doesn't include their own identity has no way
to call `PUT /api/admin/settings/tailnet-allowlist` either, since
`_enforce_tailnet_allowlist` runs ahead of every session route. `allowlist
clear` is the recovery:

    docker exec <container> python -m photos_viewer.admin allowlist clear
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from collections.abc import Sequence

from . import app_db, session_auth


def _open_db_or_none(command: str) -> sqlite3.Connection | None:
    data_dir = app_db.data_dir_from_env()
    db_path = app_db.db_path(data_dir)
    if not db_path.exists():
        print(f"{command}: no app.db at {db_path} -- check PHOTOS_VIEWER_DATA_DIR", file=sys.stderr)
        return None
    return app_db.connect(data_dir)


def _cmd_unlock(args: argparse.Namespace) -> int:
    username = args.username.strip().lower()
    conn = _open_db_or_none("unlock")
    if conn is None:
        return 1
    try:
        user = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if user is None:
            print(f"unlock: no such user {args.username!r}", file=sys.stderr)
            return 1
        session_auth.clear_login_failures(conn, username)
        if args.clear_ip_limits:
            session_auth.clear_ip_login_failures(conn)
        app_db.write_audit_log(
            conn,
            "unlock_user",
            user_id=user["id"],
            actor="cli",
            detail=f"ip_limits_cleared={'true' if args.clear_ip_limits else 'false'}",
        )
        print(f"unlocked {username!r}")
        return 0
    finally:
        conn.close()


def _cmd_allowlist_show(args: argparse.Namespace) -> int:
    conn = _open_db_or_none("allowlist")
    if conn is None:
        return 1
    try:
        identities = session_auth.get_allowed_tailnet_identities(conn)
        if not identities:
            print("(empty -- everyone allowed)")
        else:
            for identity in identities:
                print(identity)
        return 0
    finally:
        conn.close()


def _cmd_allowlist_clear(args: argparse.Namespace) -> int:
    conn = _open_db_or_none("allowlist")
    if conn is None:
        return 1
    try:
        session_auth.set_allowed_tailnet_identities(conn, [])
        app_db.write_audit_log(conn, "set_tailnet_allowlist", actor="cli", detail="count=0")
        print("allow-list cleared (everyone allowed)")
        return 0
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m photos_viewer.admin")
    subparsers = parser.add_subparsers(dest="command", required=True)

    unlock = subparsers.add_parser("unlock", help="Clear a username's login lockout.")
    unlock.add_argument("username")
    unlock.add_argument(
        "--clear-ip-limits",
        action="store_true",
        help=(
            "Also clear the per-client failed-login counters (every client, not just "
            "this user -- the per-IP limit is shared by everyone behind tailscale serve)."
        ),
    )
    unlock.set_defaults(func=_cmd_unlock)

    allowlist = subparsers.add_parser("allowlist", help="Inspect or reset the tailnet allow-list (P1.4).")
    allowlist_subparsers = allowlist.add_subparsers(dest="allowlist_command", required=True)

    allowlist_show = allowlist_subparsers.add_parser("show", help="Print the current allow-list.")
    allowlist_show.set_defaults(func=_cmd_allowlist_show)

    allowlist_clear = allowlist_subparsers.add_parser(
        "clear",
        help="Empty the allow-list (= allow everyone). Recovers an admin locked out by their own saved list.",
    )
    allowlist_clear.set_defaults(func=_cmd_allowlist_clear)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
