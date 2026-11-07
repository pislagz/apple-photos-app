"""P1.2: `app.db` schema and migrations.

The file lives under a caller-supplied directory, never inside the repo --
every test here points at `tmp_path`.
"""

import pathlib
import sqlite3

import pytest

from photos_viewer import app_db


def test_data_dir_from_env_defaults_to_data(monkeypatch):
    monkeypatch.delenv("PHOTOS_VIEWER_DATA_DIR", raising=False)

    assert app_db.data_dir_from_env() == pathlib.Path("data")


def test_data_dir_from_env_reads_the_environment_variable(monkeypatch, tmp_path):
    monkeypatch.setenv("PHOTOS_VIEWER_DATA_DIR", str(tmp_path))

    assert app_db.data_dir_from_env() == tmp_path


def test_migrate_creates_expected_tables(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        conn.close()

    assert {
        "users",
        "sessions",
        "login_failures",
        "libraries",
        "library_assignments",
        "assets",
        "thumbnail_cache",
        "audit_log",
    } <= tables


def test_connect_creates_app_db_under_the_given_directory(tmp_path):
    app_db.connect(tmp_path).close()

    assert app_db.db_path(tmp_path).exists()
    assert list(tmp_path.glob("*")) == [app_db.db_path(tmp_path)]


def test_migrate_is_idempotent(tmp_path):
    first = app_db.connect(tmp_path)
    first.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('a', 'h', 'admin')"
    )
    first.commit()
    first.close()

    second = app_db.connect(tmp_path)
    try:
        (count,) = second.execute("SELECT COUNT(*) FROM users").fetchone()
    finally:
        second.close()

    assert count == 1


def test_migrate_on_an_already_open_connection_does_not_recreate_tables(tmp_path):
    conn = app_db.connect(tmp_path)
    try:
        app_db.migrate(conn)  # must not raise "table already exists"
    finally:
        conn.close()


def test_connecting_twice_on_the_same_directory_works(tmp_path):
    first = app_db.connect(tmp_path)
    first.close()

    second = app_db.connect(tmp_path)
    second.close()


def test_connecting_an_already_migrated_db_does_not_take_the_write_lock(tmp_path):
    """Issue #12 D: `migrate()` must not run `BEGIN IMMEDIATE` on a
    `connect()` that finds nothing pending. Hold the write lock with a
    second, raw connection first -- a `connect()` that still needed the
    lock would block on it (and eventually fail once `busy_timeout`
    elapses); one that doesn't need it returns immediately regardless."""
    app_db.connect(tmp_path).close()

    blocker = sqlite3.connect(app_db.db_path(tmp_path))
    blocker.execute("BEGIN IMMEDIATE")
    try:
        app_db.connect(tmp_path).close()
    finally:
        blocker.rollback()
        blocker.close()


def test_a_failing_migration_leaves_the_version_and_schema_unchanged(
    tmp_path, monkeypatch
):
    app_db.connect(tmp_path).close()
    broken_migrations = [
        *app_db._MIGRATIONS,
        ["CREATE TABLE this_is_fine (id INTEGER)", "NOT VALID SQL"],
    ]
    monkeypatch.setattr(app_db, "_MIGRATIONS", broken_migrations)

    conn = sqlite3.connect(app_db.db_path(tmp_path))
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        with pytest.raises(sqlite3.OperationalError):
            app_db.migrate(conn)

        (version,) = conn.execute("PRAGMA user_version").fetchone()
        assert version == len(app_db._MIGRATIONS) - 1

        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert "this_is_fine" not in tables
    finally:
        conn.close()
