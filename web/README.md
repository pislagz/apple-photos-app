# Web

Vite, React, and TypeScript. Not created yet. One app, two layouts, chosen by viewport and pointer, with a setting to override. The spec allows Svelte; this handoff uses React. See `CLAUDE.md`.

Planned shape:

```
web/
  index.html
  package.json
  vite.config.ts
  src/
    main.tsx
    api.ts              session cookie client
    auth/
    layouts/
      mobile/           iOS 17 chrome: Library, Albums, People, Map
      desktop/          Sequoia chrome: sidebar, toolbar, grid, viewer
    admin/              System Settings-like sidebar, desktop first
    viewer/
    pwa/                manifest, service worker, original icons
```

Filenames must not contain `token` or `credential`.

Phase 1 ships Library and the viewer on both layouts, login, and the admin screens. Albums, People, and Map are visible and disabled until Phase 2. Match `docs/design-refs/README.md` for spacing and hierarchy. Follow `docs/SPEC.md` when a screenshot disagrees with the product (tab bar, sidebar contents, anything that edits or deletes).

The production build is self-contained. No CDN, no Google Fonts, no analytics. The server sends a Content-Security-Policy of `default-src 'self'`. The map, when it arrives in Phase 2, loads a PMTiles file from this same server.

Icons are a free set. Font is `system-ui`. Do not import files from `docs/design-refs/` into the bundle.

```bash
npm install
npm run dev
npm test
```

These do not work until P1.1. Tests run on Linux and do not need a real library.
