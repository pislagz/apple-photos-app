# Build context is the repo root:  docker build -f deploy/Dockerfile .
# The image holds code only. No library, app.db, or .env is ever copied in
# (see ../.dockerignore); libraries are bind-mounted read-only at run time.

FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
# ffmpeg: video stills. libheif1: HEIC decode (pillow-heif wheels bundle their
# own, but the system lib keeps the fallback working on any arch).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libheif1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home --home-dir /home/viewer viewer \
    && mkdir /data /libraries && chown viewer /data

WORKDIR /app
COPY server/ /app/server/
# Editable: keeps photos_viewer at /app/server/, so main.py finds /app/web/dist.
# The pip bundled with the base image can't parse some kernel version strings
# (OrbStack's "7.2.12-orbstack-...") and aborts; a current pip can.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e /app/server
COPY --from=web /src/web/dist /app/web/dist

ENV PHOTOS_VIEWER_DATA_DIR=/data \
    OSXPHOTOS_NO_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/tmp

USER viewer
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
# main.py serves web/dist from <repo>/web/dist; /app/server/photos_viewer puts
# that at /app/web/dist.
CMD ["uvicorn", "photos_viewer.main:app", "--host", "0.0.0.0", "--port", "8000"]
