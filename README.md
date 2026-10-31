# apple-photos-app

A self-hosted, strictly read-only viewer for several Apple Photos libraries (`.photoslibrary` packages) on one drive. People sign in over Tailscale. The iPhone PWA follows iOS 17 Photos. The desktop browser follows macOS Sequoia Photos. An admin registers each library and chooses which user can open it. Downloads only.

The server runs on macOS and on Linux, including Docker. Libraries are read with [osxphotos](https://github.com/RhetTbull/osxphotos) by path. PhotoKit is not used. The app never writes into a library package. At runtime it makes no outbound network requests. It only serves clients on the LAN or Tailscale.

This repository is the handoff for implementation. The app itself is not here yet.

## Read these in order

1. [CLAUDE.md](CLAUDE.md) — constraints, layout, phases, how to run tests.
2. [docs/SPEC.md](docs/SPEC.md) — product and API source of truth.
3. [docs/PRIOR_ART.md](docs/PRIOR_ART.md) — photokit-api, xpoz, libre-photos, and osxphotos, with the modules worth borrowing.
4. [docs/TASKS.md](docs/TASKS.md) — phase-by-phase tasks and acceptance criteria.
5. [docs/design-refs/README.md](docs/design-refs/README.md) — screenshot index, including the macOS 15.0 and 15.4 sidebar orders.
6. [docs/MANUAL_MAC_TESTS.md](docs/MANUAL_MAC_TESTS.md) — real-library checklist. Not part of CI.

`server/README.md` and `web/README.md` describe the packages to add. They contain no application code.

## Privacy

Do not commit a real photo, a real `.photoslibrary`, `app.db`, thumbnail caches, or a filled-in `.env`. Tests use a synthetic fixture. The images under `docs/design-refs/` are UI references only.
