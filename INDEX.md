# PR drafts index (branches pushed 2026-11-11 and 2026-11-12)

This index is for the agent that opens these PRs. Each `<issue>.md` is the PR body, exactly as written. `LINKS.md` has a compare link for each branch, with the base already set. No PR has been opened. Nothing has been merged into `main` or into any base branch. Screenshots referenced in the bodies are on the `pr-screenshots` branch.

`test/all-2026-11-11` is `main` with every branch below merged in, for manual testing only. **Do not open a PR from it or merge it.**

## Branches

| Issue | Branch | Base | Body |
| --- | --- | --- | --- |
| #250 | `fix/250-docker-pip-orbstack` | `main` | `250.md` |
| #252 (admin side only) | `feat/252-indexing-progress` | `main` | `252.md` |
| #253 | `feat/253-admin-back` | `main` | `253.md` |
| #254 | `feat/254-heic-option-only-for-heic` | `main` | `254.md` |
| #255 | `fix/255-consistent-cursor` | `main` | `255.md` |
| #257 | `fix/257-viewer-grab-cursor` | `fix/267-viewer-fit-zoom-pan` | `257.md` |
| #258 (test only) | `fix/258-check-badge` | `feat/tile-overlays-208` (#249) | `258.md` |
| #259 | `fix/259-iphone-selection-bar` | `feat/254-heic-option-only-for-heic` | `259.md` |
| #260 | `fix/260-shared-grid-header` | `main` | `260.md` |
| #261 | `fix/261-title-blur-fade` | `feat/title-209` (#243) | `261.md` |
| #263 | `feat/263-friendly-empty-states` | `main` | `263.md` |
| #264 | `fix/264-toolbar-icons` | `main` | `264.md` |
| #265 | `fix/265-reliable-double-click` | `main` | `265.md` |
| #267 | `fix/267-viewer-fit-zoom-pan` | `feat/filmstrip-221` (#248) | `267.md` |
| none (pp asked in chat) | `fix/login-button-size` | `main` | `login.md` |

## Required merge order

1. **Independent, on `main`, in any order:** #250, #252, #253, #254, #255, #260, #263, #264, #265, and the login button.
   - #264 may need a small, mechanical rebase against #244 (both edit `DesktopLibrary.tsx`).
2. **#259 after #254.** Then retarget #259 to `main`.
3. **#267 after `feat/filmstrip-221`** (#248, which sits on #245–#247). Then **#257 after #267**, retargeted to `feat/filmstrip-221` or `main`.
4. **#258 with or after #249** (`feat/tile-overlays-208`). #258 only adds a test.
5. **#261 after `feat/title-209`** (#243).

Cross-PR conflicts. Every branch merges cleanly onto its own base; these only show up when they meet. They were resolved on `test/all-2026-11-11`, which can serve as a reference.
- **#255 with #259:** #259 adds `cursor: pointer` in three `shell.css` rules: `.mobile-library__bar-button`, `.zip-status__option--row` and its `input[role="switch"]`. #255's `src/cursors.test.ts` fails on any `cursor: pointer`. Whichever of the two merges second must change those three rules to `cursor: default`.
- **#249/#258 with #265:** #265 moves the desktop tile into a memoised `GridCell`. #249's click flash, `TileOverlays` and `CheckBadge` have to move into `GridCell`, as `flash` and `tileWidth` props, with the flash trigger inside #265's `handleCellClick`.
- **#261 with #260:** the shared iPhone `MobileGridHeader` (#260) has to take #209's title block and #261's `--title-scrim` style.

## ⚠️ Still open for pp

- **#250:** never built. Docker wasn't running on this machine, and CI only validates the compose file. Run `docker compose -f deploy/docker-compose.yml up --build` once on OrbStack before merging.
- **#252:**
  - **Not finished.** The non-admin "Your library is being prepared…" screen is missing. Don't close #252 with this PR.
  - The walk now takes `list(photosdb.photos())` for the total. It costs no extra memory with real osxphotos, which already returns a list.
- **#257:**
  - No screenshot, because headless Chromium doesn't draw the cursor. The cursor values were measured instead.
  - The `polish.e2e.ts` "reduced motion" failure also shows up here; see #267.
- **#258:** a test-only PR. Close it if that's unwanted, and close #258 once #249 merges.
- **#259:**
  - Wording for pp to decide: the caption "Downloads together as one ZIP file." / "Downloads as a ZIP file.", and the option label "HEIC as JPEG" or "Convert iPhone photos to JPEG".
  - Download is icon-only, because a visible label collides with the centred count at 320 px.
  - A single selected photo still downloads as a ZIP.
- **#260:**
  - Pushed grids no longer overlay the date label.
  - The Search tab is unchanged.
  - The PR also fixes two e2e specs that were already broken on `main`: the `search` and `map` sign-in locator, and `search`'s alt-text selector.
- **#261:**
  - The tint starts at 40 % strength at scroll 0, not 0, so the title stays readable on bright photos.
  - iPhone Days keeps the full scrim.
- **#263:** the welcome and empty-state copy is a first pass.
- **#265:** the "whole grid flashes black" part isn't verified on the `feat/filmstrip-221` stack, because it doesn't reproduce on `main`. Re-check it after the stack is rebased onto this. If it still flashes, it's a separate bug, probably in #247.
- **#267:**
  - The demo library can't reproduce the bug. Re-check on a real library; details under "Not verified".
  - It also fixes `useDismiss` under StrictMode, where the viewer never closed in `vite dev`.
  - It makes one flaky `HiddenView` test deterministic.
  - **A failure that predates this PR:** `e2e/polish.e2e.ts` "reduced motion › motion on: viewer dismiss animates" fails in all three projects, on `feat/filmstrip-221` itself too. #220's zoom-to-tile close replaced the `.is-closing` fade the test waits for. Update the test or change #220.

## Tests run and results

Server runs used Python 3.12.7 on macOS with `OSXPHOTOS_NO_VERSION_CHECK=1`. Web runs used Node 22. "Demo" means Playwright against `scripts/dev_demo.py` (520 synthetic assets) built from that branch. "Mock" means Vite dev with a mocked `/api`.

| Branch | Results |
| --- | --- |
| #250 | None locally. CI's compose validation only. |
| #252 | pytest 556 passed, 3 skipped; ruff check and format clean; vitest 493/493; `tsc`; `check-colours`. Not run on the demo. |
| #253 | `AdminApp.test.tsx` cases; full vitest suite, `tsc`, `check-colours` pass. |
| #254 | pytest 555 passed, 3 skipped (`main`: 554); ruff clean; web suite and `tsc` pass. |
| #255 | `src/cursors.test.ts`. Demo: `polish.e2e.ts` 14 passed, 7 skipped by design. |
| #257 | vitest 591/591; `tsc`; `check-colours`. `viewer-fit.e2e.ts` cursor test passes on mock and demo. Same demo run: `polish` "reduced motion" fails 3/3, which also fails on the base. |
| #258 | One `TileOverlays.test.tsx` test. Look checked in Chromium (iPhone and desktop screenshots). |
| #259 | vitest 500/500; `tsc`; `check-colours`. Demo: `select-bar.e2e.ts` 2 passed (iphone, small), 1 skipped (desktop). |
| #260 | vitest 491/491; `tsc`; `check-colours`. Demo: `grid-header`, `search`, `map`, `polish` and `shots` pass. Select measured at y = 10 px in Library, Videos and Screenshots. |
| #261 | vitest 503/503; `tsc`; `check-colours`. Mock: Chromium measurements at 0, 24, 60 and 300 px scroll. |
| #263 | Full vitest suite, `tsc`, `check-colours` pass. |
| #264 | `DesktopLibrary.test.tsx` cases; full suite and `tsc` pass. |
| #265 | Six "double-click reliability" tests; 4 of them fail against `main`'s code. Full suite (496) and `tsc` pass. |
| #267 | vitest 588/588; `tsc`; `check-colours`. Mock: `viewer-fit.e2e.ts` passes in all projects and fails on the base source. Demo: 5 passed in each of 3 runs; a final run including the new "touches the stage" assertion passed on the #257 build, which contains #267. |
| login | Demo: `login-layout.e2e.ts` 3 passed (desktop, iphone, small). vitest 490/490; `check-colours`. |
| `test/all-2026-11-11` | `TESTING-2026-11-11.md` on that branch reports vitest 652 passed, pytest 557 passed / 3 skipped, and `tsc`, ruff and `check-colours` clean. That run's output isn't in the visible log of the session that wrote this index, so treat those numbers as unconfirmed. |

## Not verified

- **#250:** the Docker image build, on OrbStack or Docker Desktop.
- **#252:**
  - The progress UI against a real, slow index. The demo finishes in under one 2 s poll.
  - No screenshot.
- **#253, #254, #263, #264:** no browser end-to-end run on the demo; unit tests only. #264's screenshot renders the `Icon` component, not the running app.
- **#257:** the cursor appearance itself. Only computed values were read.
- **#258:** relies on #249's implementation; this PR adds only the test.
- **#261:** no Playwright spec. Checked in the mock only, not on the demo.
- **#265:** the black flash on the viewer stack.
- **#267:**
  - Tested on the demo's 480×640 and 640×480 images only. They never overflow the stage, so the demo can't show the original bug.
  - The fix is guarded by the CSS unit test and the mock run (4032×3024 SVGs), which fails on the base.
  - Not checked on a real library or a real iPhone.
- **login:**
  - The first-run Setup screen shares these styles and wasn't checked visually.
  - Phone layouts were checked in emulation only.
- **No branch was tested on a real device or a real `.photoslibrary`.** Everything ran on the synthetic demo library or mocks.
