"""Issue #12 H: `python -m photos_viewer.admin unlock <username>`, for an
admin locked out with no server running (works via `docker exec`)."""

import pytest

from photos_viewer import admin, app_db, session_auth

VALID_PASSWORD = "correct-horse-battery"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("PHOTOS_VIEWER_DATA_DIR", str(tmp_path))
    return tmp_path


def _create_user(data_dir, username, *, role="user"):
    conn = app_db.connect(data_dir)
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, session_auth.hash_password(VALID_PASSWORD), role),
        )
        conn.commit()
    finally:
        conn.close()


def test_unlock_clears_a_locked_out_users_failures(data_dir):
    _create_user(data_dir, "bob")
    conn = app_db.connect(data_dir)
    try:
        for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
            session_auth.record_login_failure(conn, "bob", user_exists=True)
        assert session_auth.is_locked_out(conn, "bob", user_exists=True) is True
    finally:
        conn.close()

    exit_code = admin.main(["unlock", "bob"])

    assert exit_code == 0
    conn = app_db.connect(data_dir)
    try:
        assert session_auth.is_locked_out(conn, "bob", user_exists=True) is False
    finally:
        conn.close()


def test_unlock_normalizes_the_username(data_dir):
    _create_user(data_dir, "bob")

    exit_code = admin.main(["unlock", "  BOB  "])

    assert exit_code == 0


def test_unlock_exits_non_zero_for_an_unknown_user(data_dir, capsys):
    exit_code = admin.main(["unlock", "nobody"])

    assert exit_code != 0
    assert "nobody" in capsys.readouterr().err


def test_unlock_clear_ip_limits_also_clears_the_per_client_counters(data_dir):
    _create_user(data_dir, "bob")
    conn = app_db.connect(data_dir)
    try:
        session_auth.record_ip_login_failure(conn, "tailscale-user:alice")
        (before,) = conn.execute("SELECT COUNT(*) FROM ip_login_failures").fetchone()
        assert before == 1
    finally:
        conn.close()

    exit_code = admin.main(["unlock", "bob", "--clear-ip-limits"])

    assert exit_code == 0
    conn = app_db.connect(data_dir)
    try:
        (after,) = conn.execute("SELECT COUNT(*) FROM ip_login_failures").fetchone()
        assert after == 0
    finally:
        conn.close()


def test_unlock_without_clear_ip_limits_leaves_the_per_client_counters_alone(data_dir):
    _create_user(data_dir, "bob")
    conn = app_db.connect(data_dir)
    try:
        session_auth.record_ip_login_failure(conn, "tailscale-user:alice")
    finally:
        conn.close()

    admin.main(["unlock", "bob"])

    conn = app_db.connect(data_dir)
    try:
        (count,) = conn.execute("SELECT COUNT(*) FROM ip_login_failures").fetchone()
        assert count == 1
    finally:
        conn.close()
