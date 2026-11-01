"""CLI for operations that must work without a running server.

The motivating case (issue #12): an admin locked out of their own account
behind `tailscale serve` has no way to call the `/api/admin/*` unlock route,
since that route itself requires a session. This works directly on `app.db`
under `PHOTOS_VIEWER_DATA_DIR`, so it also works inside the Docker/OrbStack
container with no server running:

    docker exec <container> python -m photos_viewer.admin unlock <username>
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence

from . import app_db, session_auth


def _cmd_unlock(args: argparse.Namespace) -> int:
    username = args.username.strip().lower()
    conn = app_db.connect(app_db.data_dir_from_env())
    try:
        user = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if user is None:
            print(f"unlock: no such user {args.username!r}", file=sys.stderr)
            return 1
        session_auth.clear_login_failures(conn, username)
        if args.clear_ip_limits:
            conn.execute("DELETE FROM ip_login_failures")
            conn.commit()
        print(f"unlocked {username!r}")
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

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
