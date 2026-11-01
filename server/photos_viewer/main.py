"""FastAPI app: serves `/api` and, once built, the web app.

Importing this module must never touch disk -- `session_auth.get_db` opens
`app.db` lazily, per request, so `GET /api/health` (and simply importing
`app`) stay side-effect-free. That keeps `pytest` from creating an `app.db`
or a `data/` directory anywhere in the repo.
"""

from __future__ import annotations

from fastapi import FastAPI

from .library_admin import router as library_admin_router
from .session_auth import router as auth_router
from .session_auth import validate_public_origins_env, validate_trusted_proxies_env


def create_app() -> FastAPI:
    validate_public_origins_env()
    validate_trusted_proxies_env()
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(library_admin_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
