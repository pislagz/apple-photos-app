# Web

Vite, React, and TypeScript. One app, two layouts, chosen by viewport and pointer, with a setting to override. The spec allows Svelte; this handoff uses React. See `CLAUDE.md`.

P1.1 created the skeleton below: `index.html`, `package.json`, `tsconfig.json` (`strict`), `vite.config.ts` (Vitest config lives here too), and `src/main.tsx` / `src/App.tsx` with a placeholder `App.test.tsx`. Everything past `App.tsx` is still planned, landing with the layouts, admin screens, and viewer in later P1.x issues:

```
web/
  index.html
  package.json
  vite.config.ts
  src/
    main.tsx
    App.tsx             placeholder root; P1.11 replaces it with the real shell
    test-setup.ts
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

The production build is self-contained. No CDN, no Google Fonts, no analytics. The server sends a Content-Security-Policy of `default-src 'self'`, with `tile.openstreetmap.org` as the only external host. The default map loads those raster tiles in the browser when a map view is open. An admin can switch to a local PMTiles file served by this app, or turn the basemap off.

Icons are a free set. Font is `system-ui`. Do not import files from `docs/design-refs/` into the bundle.

```bash
npm install
npm run dev
npm test
npm run build
```

These work now. Tests run on Linux and do not need a real library.
