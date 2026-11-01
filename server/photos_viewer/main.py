"""FastAPI app: serves `/api` and, once built, the web app.

Importing this module must never touch disk -- `session_auth.get_db` opens
`app.db` lazily, per request, so `GET /api/health` (and simply importing
`app`) stay side-effect-free. That keeps `pytest` from creating an `app.db`
or a `data/` directory anywhere in the repo.
"""

from __future__ import annotations

from fastapi import FastAPI

from .session_auth import router as auth_router


def create_app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
