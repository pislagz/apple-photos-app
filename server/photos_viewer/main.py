"""FastAPI app: serves `/api` and, once built, the web app.

Importing this module must never touch disk -- `session_auth.get_db` opens
`app.db` lazily, per request, so `GET /api/health` (and simply importing
`app`) stay side-effect-free. That keeps `pytest` from creating an `app.db`
or a `data/` directory anywhere in the repo.
"""

from __future__ import annotations

import logging
import pathlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request

from . import app_db
from .admin_panel import router as admin_panel_router
from .library_admin import reset_stale_indexing_state
from .library_admin import router as library_admin_router
from .library_albums import router as library_albums_router
from .library_assets import router as library_assets_router
from .library_people import router as library_people_router
from .library_watch import LibraryChecker
from .session_auth import (
    get_data_dir,
    validate_public_origins_env,
    validate_trusted_proxies_env,
)
from .session_auth import router as auth_router

logger = logging.getLogger(__name__)

# server/photos_viewer/main.py -> server/photos_viewer -> server -> repo root
_DEFAULT_WEB_DIST_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / "web" / "dist"

# Session/account state that must never be served from a disk or history
# cache -- `/api/me` and `/api/auth/*` carry who-is-signed-in, `/api/setup/*`
# is the first-run admin flow, and `/api/admin/*` is every admin JSON
# response (users, sessions, audit log, settings).
_NO_STORE_PREFIXES = ("/api/me/", "/api/auth/", "/api/setup/", "/api/admin/")
_NO_STORE_EXACT = ("/api/me",)


# P1.20. The one external host is the OSM raster tile server, on connect-src
# because MapLibre fetches tile bytes (it then draws them from blob: URLs,
# covered by img-src). No worker-src: the web app has no MapLibre worker yet;
# add `worker-src 'self' blob:` with the Phase 2 map only if it needs one.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "font-src 'self'; "
    "img-src 'self' blob: data:; "
    "connect-src 'self' https://tile.openstreetmap.org; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'"
)


class _NoStoreMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        path = request.url.path
        if path in _NO_STORE_EXACT or path.startswith(_NO_STORE_PREFIXES):
            response.headers["Cache-Control"] = "no-store"
        return response


def _safe_dist_file(dist_dir: pathlib.Path, full_path: str) -> pathlib.Path | None:
    """The file `full_path` resolves to inside `dist_dir`, or None if it
    doesn't exist or `full_path` (e.g. `../../etc/passwd`) escapes
    `dist_dir` entirely."""
    if not full_path:
        return None
    candidate = (dist_dir / full_path).resolve()
    try:
        candidate.relative_to(dist_dir.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def _mount_web_app(app: FastAPI, dist_dir: pathlib.Path) -> None:
    """Serve the built PWA: a hashed `/assets/*` file or any other static
    file under `dist_dir` as itself, `index.html` for everything else
    (including `/admin` and other client-side routes), and `sw.js` /
    `manifest.webmanifest` with the headers a service worker and a PWA
    manifest need. `/api/*` is excluded up front so an unknown API path
    still 404s as JSON instead of falling back to `index.html`."""
    index_path = dist_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_web_app(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")

        safe_path = _safe_dist_file(dist_dir, full_path)
        if safe_path is None:
            return FileResponse(index_path)
        if full_path == "sw.js":
            # Never let the browser's HTTP cache serve a stale service
            # worker script -- that's how a shipped fix stops reaching
            # already-installed clients.
            return FileResponse(safe_path, headers={"Cache-Control": "no-cache"})
        if full_path == "manifest.webmanifest":
            return FileResponse(safe_path, media_type="application/manifest+json")
        return FileResponse(safe_path)


def _reset_stale_indexing_on_startup(app: FastAPI) -> None:
    # Respects `get_data_dir`'s dependency override in tests. Skips entirely
    # when no `app.db` exists yet at that path -- `connect()` would otherwise
    # create one, which a plain `GET /api/health` (no library ever
    # registered) must never do.
    data_dir = app.dependency_overrides.get(get_data_dir, get_data_dir)()
    if not app_db.db_path(data_dir).exists():
        return
    conn = app_db.connect(data_dir)
    try:
        reset_stale_indexing_state(conn)
    finally:
        conn.close()


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    _reset_stale_indexing_on_startup(app)
    # Stat-only polling for replaced/copying libraries (P1.22). Resolves the
    # data dir on every pass so it follows `app.db` appearing later.
    checker = LibraryChecker(lambda: app.dependency_overrides.get(get_data_dir, get_data_dir)())
    app.state.library_checker = checker
    checker.start()
    try:
        yield
    finally:
        checker.stop()


def create_app(web_dist_dir: pathlib.Path | None = None) -> FastAPI:
    validate_public_origins_env()
    validate_trusted_proxies_env()
    app = FastAPI(lifespan=_lifespan)
    app.add_middleware(_NoStoreMiddleware)
    app.include_router(auth_router)
    app.include_router(library_admin_router)
    app.include_router(library_albums_router)
    app.include_router(library_people_router)
    app.include_router(library_assets_router)
    app.include_router(admin_panel_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    dist_dir = web_dist_dir if web_dist_dir is not None else _DEFAULT_WEB_DIST_DIR
    if (dist_dir / "index.html").is_file():
        _mount_web_app(app, dist_dir)
    elif dist_dir.is_dir():
        # A half-finished build: mounting would make every non-API path 500.
        logger.warning("%s has no index.html; the web app is not served (run `npm run build`)", dist_dir)

    return app


app = create_app()
