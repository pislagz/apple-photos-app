# #288: Admin panel UX overhaul: research and design proposal

Status: proposal, no code changed. Related: #268 (info icons on Settings).
Reference: Apple System Settings (macOS Ventura+) and iOS Settings: grouped inset lists, one row = label left / value right, a disclosure chevron to a detail view, and a small grey footer under each group that explains it in plain words.

Sources read: `web/src/admin/AdminApp.tsx`, `admin.css`, `api.ts`, `screens/*.tsx`; server `library_admin.py`, `admin_panel.py`, `session_auth.py`, `library_watch.py`, `media.py`, `deploy/docker-compose.yml`, `docs/SPEC.md` ("Admin panel").

---

## 1. Audit of the current admin UI

Shell (`AdminApp.tsx`, `admin.css`): a 220px sidebar with six text buttons (Libraries, Users, Access, Sessions, Audit log, Settings), a 980px content column, and on phones the sidebar becomes a horizontal strip (`@media (max-width: 700px)`). Sign-in is a bare form. An opt-in banner ("Map & place names") sits above every screen until answered. The skeleton is already System-Settings-like, but every screen below it is a form or a table, not a grouped list.

### Libraries (`screens/LibrariesScreen.tsx`, `PrewarmControls.tsx`, `ReplaceDialog.tsx`)
Shows today:
- An "Add library" form: free-text **Path** (placeholder `/libraries/Family.photoslibrary`) and optional **Display name**.
- A 4-column table: Name, **Path**, Status, Actions.
- Status is empty until you press **Load status** per library (an extra click for every row; status is not fetched automatically).
- Once loaded, Status is a bullet list: "`20 assets`", "`3 videos`", `last_indexed_at` as a raw string, `last_update.summary` (server-built string containing `finished_at`), the thumbnail pre-warm block (progress bar and 3 buttons), "Being updated: <reason>", a replacement suggestion with button, "Other libraries next to it" with a button each, warnings, and a collapsible "Update history" of up to 10 lines like `2026-11-12 09:14:03 · auto · applied: Updated 2026-11-12 09:14:41: 3 added, 0 removed, 0 changed`.
- Actions column: Rename (a `window.prompt`), Re-index, Replace library file (opens an inline dialog, not a real modal), Remove (a `window.confirm`).

Raw or technical:
- Full filesystem path in its own column and in the Replace dialog ("Currently: /libraries/...").
- ISO-ish timestamps (`last_indexed_at`, `run.started_at`, and `finished_at` embedded in the server-built `RunSummary.summary` in `library_admin.py` `_run_summary`).
- Jargon: "assets" (people say photos), "Re-index", "pre-warm", "pre-generated", "could not be decoded", "Same library store: unknown", "trigger" (`auto`/`manual`) and "outcome" (`applied`/`failed`/`not ready`) shown raw in history.
- `total_size_bytes` exists in the status response but is not shown at all.
- Warning text from the server mentions "'Optimize Mac Storage'" and percentages without saying what to do (`optimize_storage_message`).
- `Replace anyway` appears twice (a checkbox and the button label).

Inconsistent controls: Rename and Remove use native `prompt()`/`confirm()` while Replace uses an in-page dialog; Clear thumbnail cache uses `confirm()`; the Add form's primary button is accent-filled (`form > button[type=submit]`) but table buttons are grey-fill; inline `<button>` inside `<li>` get no margin rules (only `td button` does).

### Users (`screens/UsersScreen.tsx`)
Shows today: Create user form (username, password, role select with options `user` / `admin`), a table (Username, Role select, `enabled`/`disabled`, four buttons: Enable/Disable, Set password, Unlock, Delete), an "Invites" section with a role select and "Create invite link", and a plain `<ul>` of invites: `user -- created by pp -- expires 2026-11-19 12:00:00`.

Raw or technical: role values in lowercase code-style words; the invite list prints the expiry as a raw timestamp and uses `--`; the invite link is shown as `<code>` with no copy button; "Unlock" is unexplained (it clears a failed-login lockout); "Set password" uses `window.prompt` (shows the typed password in clear text; there is no confirm field); role is changed by an inline select that saves immediately with no confirmation, including demoting an admin.

Inconsistent: role is a `<select>` in the table but the create form is a separate card; actions are four same-weight buttons; Delete is not styled as destructive.

### Access (`screens/AccessScreen.tsx`)
A matrix: one column per library, one row per user, a checkbox in each cell, labelled `user × library` for screen readers. Fine for two or three libraries; with many libraries the table scrolls sideways (`.admin-table-wrap`). Nothing explains that an admin must assign themselves to see photos, which is a hard rule in CLAUDE.md. Admin users are not distinguished. Toggling saves immediately with no feedback.

### Sessions (`screens/SessionsScreen.tsx`)
Table: User, Device (`session.device ?? "unknown"`, a raw user-agent-like string), Last seen (raw `last_seen_at`), Revoke (`window.confirm`). The API also returns `created_at`, `expires_at`, `remember_me`, none shown. There is no marker for "this is your current session", so an admin can revoke themselves. No empty state.

### Audit log (`screens/AuditLogScreen.tsx`)
Filter form: **User id** and **Library id** as free-text numeric fields (people do not know ids; the matrix response already has the names), date From/To, Filter, Export CSV link. Table: When (raw `occurred_at`), Action (raw action code such as `add_library`, `library.check_now`, `prewarm.auto_restart`, `osm_consent_agreed`, `set_tailnet_allowlist`), Actor, User, Library, Detail (raw string such as `id=3 display_name='Family' path=/libraries/...`). Server returns up to 200 (limit param up to 1000, offset exists) but the UI has no paging or "load more", so older entries are unreachable except by CSV. Action codes are inconsistent in style (`add_library` vs `library.check_now`).

### Settings (`screens/SettingsScreen.tsx`)
One long card, in this order: three session lifetimes **in seconds** (defaults 43200, 2592000, 15552000), three thumbnail sizes (grid, "grid 2x", preview, in pixels, unlabelled units), thumbnail quality (1 to 100, unlabelled), **Zip size limit (bytes)** (default 2147483648), the "Map & place names" fieldset (consent checkbox, long hint paragraphs, a PMTiles path, place-name download status "(NN KB)" and a button), a "Manual only" checkbox, "Check libraries every (minutes)", "Library must be unchanged for (minutes) before it is re-indexed", "Tell users when their library was updated", then **Save settings** and **Check now** side by side. A second form below holds the "Tailnet allow-list" textarea ("Identities, one per line") with its own Save button.

Raw or technical:
- Seconds and bytes (the issue's examples). 12 hours is shown as `43200`.
- Words a non-technical person will not know: PWA, "Remember me" lifetime, "grid 2x", PMTiles, "Tailnet", "identities", "re-indexed", "unchanged for".
- `media_cache_size_limit_bytes` is in the API and the server defaults (5 GiB) but has no field in the UI at all.
- Two Save buttons for two forms on one screen; Check now is an action but sits beside Save as if it were part of the form; a successful save is just a `<p>` with no styling.
- Number inputs allow nonsense until submit (server enforces `ge=60` seconds etc.; the UI only blocks empty values).

### Cross-cutting
- Errors are `<p role="alert">` at the top of the screen, far from the control that caused them, and are never cleared by success on some screens (Users, Sessions, Access do not clear on success).
- No loading states, no empty states (empty tables render a header and nothing else).
- Native `prompt`/`confirm` used in 7 places (rename library, remove library, clear cache, rename/password/delete user, revoke session); they look foreign next to the grouped UI, cannot be styled, and cannot hold an explanation.
- Control sizes: only padding is set (`--space-6` vertical on both inputs and buttons), so heights come from font and border and differ between `input`, `select`, `textarea` and `button` (see section 4). On phones inputs bump to `--font-size-body-lg` but buttons do not, and `.admin-actions button` shrinks to `3px` padding and caption size (below the usual 44px touch target).
- No (i) help anywhere (#268).

---

## 2. Proposed design

### 2.0 Global pattern (all screens)

Layout, borrowed from System Settings:
- **Sidebar** keeps six items but gets icons from the existing set (`shell/icons.tsx`) and friendlier names: Libraries, People (was Users), Sharing (was Access), Devices (was Sessions), Activity (was Audit log), Settings. Open question 1 asks whether to rename. If not renamed, keep the old names; nothing else depends on it.
- **Page** = large title, then groups. A **group** is an inset rounded card (`--color-card`, `--radius-card`, as today) containing **rows**. A **row** is 44px minimum, label (and optional secondary line) on the left, value or control on the right, optional chevron. Rows are separated by an inset hairline. A **footer** is caption-size secondary text under the card (class like `admin-footer`; the current `.admin-hint` is this idea, used inconsistently).
- **Detail views**: a row with a chevron opens a detail page in the same column with a "‹ Libraries" back link (a simple hash route, `#libraries/3`; no router library needed). On phone this is the iOS push pattern; on desktop it replaces the content column.
- **(i) buttons** (from #268) sit after labels of rows that have a consequence, and after every action button's label in a detail view. One shared `InfoButton` component: real `<button aria-label="About X">`, popover on hover/focus/tap.
- **Dialogs**: one shared modal sheet (`role="dialog"`, `aria-modal`, focus trap, Escape cancels) replacing `window.prompt` / `window.confirm`. Destructive confirm has: a title that names the thing, one sentence on what happens, one sentence on what does not happen (usually "your photos are not touched"), a red action button labelled with the verb ("Remove library"), and a plain Cancel. Never "OK".
- **Time**: one helper `formatWhen(iso)`: "Just now", "5 minutes ago", "Today at 14:05", "Yesterday at 09:14", "12 Nov 2026" past 7 days; the full date and time is in a `title`/tooltip. The server stores UTC strings without a zone marker in places; the helper must treat them as UTC (verify, see section 6).
- **Size**: one helper `formatBytes`: 1 decimal, MB/GB/TB; **Duration**: `formatDuration`: "12 hours", "30 days", "6 months".
- **Feedback**: successful saves show a brief inline "Saved" (a `role="status"` line in the group footer), not a banner at the top; errors show in the footer of the group they belong to, in the danger colour.
- **Loading**: skeleton rows (same height as real rows) instead of blank.

### 2.1 Libraries

List page. One group, "Libraries", one row per library:

```
[icon] Family                                   Ready · 20,412 photos  ›
       Updated 3 hours ago
```
- Left: display name, secondary line "Updated <relative time>" (from `last_indexed_at`, or "Not indexed yet").
- Right: status text + photo count, chevron. Status words (derived on the client from `index_state`, `updating`, `warnings`, `prewarm`):
  - **Ready** (green dot), **Updating…** (spinner; "Being updated" reason moves to detail), **Needs attention** (orange; any warning or suggestion), **Not found** (red; `warnings` includes the missing-file code or `suggestion` present), **Can't open** (red; unsupported version).
- Status is fetched for all rows on load (the list calls `/status` per library in parallel; with a handful of libraries that is fine; if it ever is not, see issue F). No more "Load status" button.
- Footer: "Libraries are read-only. This app never changes, moves or deletes the files in a library."
- Below the group: a button row "Add Library…" (accent text button, like iOS "Add Account…").
- Empty state (no libraries): centred icon, "No libraries yet", "Add a Photos library to start. The library folder has to be connected to the server first." and the primary button "Add Library…".

Detail page for one library (chevron). Groups, top to bottom:
1. **Header group**: Name (row; tap to rename inline: the row becomes an input with Done/Cancel, no `prompt`), Photos (`20,412`), Videos (`312`), People (`18`), Size on disk (`412 GB`, from `total_size_bytes`, which is already returned but unused), Location (`Family.photoslibrary`; the full path shows only on tap/long hover, see Replace), Last updated ("3 hours ago"), Added to this app ("12 Oct 2026").
2. **Status** group (only when there is something to say): one row per warning with icon, plain sentence, and where relevant the fix ("Photos has not stored 1,240 full-size originals (6%) in this copy. Downloads of those photos will be smaller than the original. This usually means "Optimise Mac Storage" was on when the library was copied."). Update-in-progress row with spinner.
3. **Thumbnails** group (this is PrewarmControls, restated):
   - Row "Thumbnails": value "Ready for 20,100 of 20,412" or "Not prepared yet" with a progress bar while running.
   - Action rows (full-width text buttons, in a group like iOS "Reset" rows): **Prepare thumbnails** / **Pause** / **Resume**, and **Delete thumbnail cache**.
4. **Maintenance** group: **Check for changes now** (the per-library Re-index), **Replace Library File…**.
5. **Update history** group (a disclosure row "Recent updates ›" opens a list): "Today at 09:14: Updated. 3 photos added." One line per run, not three fields. Failed runs show the reason in plain words under it.
6. **Remove** group: a single red row "Remove Library from App…".

Plain-language copy for every action (the text of each (i) and the footer under its row):

| Action (new label, old label) | What it does | When to use it |
| --- | --- | --- |
| **Check for changes now** (Re-index) | "Reads the library again and updates this app's list of photos. Your library files are not changed." | "Use it right after you copy new photos into the library and don't want to wait for the automatic check. It can take a few minutes for big libraries." |
| **Replace Library File…** | "Points this library at a different Photos library file, for example after you copied a newer version over. The name, who can see it, and settings stay the same." | "Use it when the library moved or you have a newer copy. You will see what changes before anything happens." |
| **Prepare thumbnails** / Start pre-warm | "Makes all the small preview pictures ahead of time, so browsing is fast the first time. Uses some disk space and processor time while it runs; you can pause." | "Use it once after adding a big library, ideally when nobody is using the app. If you skip it, thumbnails are made the first time someone scrolls to them, which feels slower." |
| **Pause** / **Resume** | "Stops preparing thumbnails and keeps what is done. Resume continues where it stopped." | "Use it if the server feels slow." |
| **Delete thumbnail cache** (Clear thumbnail cache) | "Deletes the small preview pictures this app made (about 1.2 GB for this library). They are made again when needed. Your photos are not touched." | "Use it to free disk space, or if previews look wrong or out of date." |
| **Rename** | "Changes the name people see in the app. The library file keeps its name." | (none needed) |
| **Remove Library from App…** | "Takes this library out of the app. People will no longer see it. The photos and the library file stay exactly where they are." | "Use it when you are done sharing it. You can add it again later; sharing choices will have to be set again." |

Confirmation wording:
- **Remove**: title "Remove "Family"?"; body "People will no longer be able to see it in this app. Your photos and the library file are not deleted. Sharing choices for this library will be forgotten."; buttons **Remove Library** (red), Cancel. (Source: `remove_library` deletes the row and cascades assignments, indexed assets and thumbnail-cache rows, per its docstring.)
- **Delete thumbnail cache**: title "Delete thumbnail cache?"; body "This frees about 1.2 GB. Thumbnails are made again when someone opens the library, which can feel slower for a while. Your photos are not touched."; buttons **Delete Cache** (red), Cancel. Needs the cache size: `freed_bytes` is only known after the call today (see issue F; until then say "This frees disk space.").
- **Replace**: keep the existing preview step but rewrite it as a sheet: "Replace "Family" with "Family 2026"?"; summary rows: "In the new file: 20,640 photos", "Will be added: 228", "Will be removed: 0", "Same library as before: Yes / No / Can't tell". Warning rows in plain words. If the overlap is low or the store differs, the confirm button becomes red "Replace Anyway" and a footer says "These look like different libraries. Anyone who had photos in the old one may lose them from their view." Remove the separate checkbox: one deliberate red button is enough.

Replace dialog: no typed path either; the "New file" row opens the same picker as Add (section 3), pre-selecting the server's `suggestion` as it does today ("Suggested: Family 2026.photoslibrary, newest next to the old one").

Add library flow (sheet, "Add Library"):
1. A list of the library packages found (section 3): name, size, "Already added" greyed out for registered ones, "Can't be opened" with reason for unsupported versions (optional, issue C).
2. Choose one → second step shows "Name" (prefilled from the package name, editable) and "Add" button. On success the app lands on the new library's detail page where Status says "Reading photos…" (the add call already schedules a background index).
3. Empty state when nothing is found: "No libraries found. Put a .photoslibrary file in the libraries folder on the computer that runs this app, then press Refresh." Then a one-line collapsible "How do I connect a library?" with Docker wording: "On the server, add your library folder in `docker-compose.yml` under `volumes`, for example `/path/to/photos:/libraries:ro`, then restart." (matching `deploy/docker-compose.yml`, `PHOTOS_LIBRARY_DIR`), and the Mac wording: "Choose the folder in Settings" if a Mac configuration exists (question 4).
4. An "Enter a path instead" link at the bottom (collapsed, "Advanced"), for libraries outside the root; kept because macOS non-Docker installs have no single libraries folder (question 3).

### 2.2 Users (renamed "People" or kept "Users": question 1)

Page: group "Users", one row per user:
```
pp                              Administrator  ›
Anna                            Can see 2 libraries  ›
Tom  (turned off)               Turned off  ›
```
- Right-hand value: "Administrator" or "Can see N libraries" (N from `assignments`) or "Turned off". "You" tag on your own row.
- Footer: "Administrators can manage libraries and users. Everyone else can only view the libraries you share with them."
- "Add User…" and "Invite Someone…" as two text-button rows under the group.
- Empty state: not reachable (an admin always exists).

User detail page:
- Group 1: **Name** (read-only), **Role** (value "Administrator"/"Person", opens a two-option sheet; footer: "An administrator can change everything in this panel. An administrator still has to share a library with themselves to see its photos."), **Account** toggle "Allowed to sign in".
- Group 2 "Libraries" (this absorbs the Access matrix per user: a toggle row per library; see 2.3).
- Group 3: **Change Password…** (sheet with new password and repeat fields), **Unlock Account** (shown only if locked; the API has no "is locked" flag today, so it is shown always with the explanation; see issue F).
- Group 4: red **Delete User…**.

Copy:
| Action | What it does | When to use it |
| --- | --- | --- |
| Allowed to sign in (Enable/Disable) | "Turn off to stop this person using the app. Their sharing choices are kept; turn it back on any time." | "Use it instead of deleting when someone is away or you're unsure." |
| Change Password… | "Sets a new password. They will need it next time they sign in. Existing sign-ins stay active unless you also sign them out in Devices." | (verify whether the server revokes sessions on password change; see section 6) |
| Unlock Account | "After too many wrong passwords an account is locked for a while. This lets the person try again right away." | "Use it when someone says they can't sign in even with the right password." |
| Delete User… | "Removes the account for good." | "Use Turn off if you may want it back." |

Delete confirmation: title "Delete "Anna"?"; body "Anna will be signed out and the account is removed for good. Photos and libraries are not affected."; buttons **Delete User** (red), Cancel.

Invites: a group "Invitations" below the users, footer "An invitation is a one-time link. Send it to the person; they pick their own username and password. It stops working after 7 days or once used." (check the real expiry; the audit found `expires_at` only). Row per open invite: "For: Person · Created by pp · Expires in 6 days" and a "Revoke" action if an endpoint exists (none does today: see section 6 and issue F). After "Invite Someone…": a sheet with role and "Create Link", then the link in a read-only field with a **Copy** button and "This link is shown only now." Empty state: "No open invitations."

### 2.3 Access ("Sharing")

Two views of the same data, chosen to match how people think:
- Primary: in each **library detail** page and each **user detail** page, a "Who can see this" / "Libraries" group with one toggle row per person/library. Toggles save immediately with an inline "Saved".
- The matrix page stays as the overview, but restyled: person rows, library columns, **switches** not checkboxes, sticky first column so it scrolls well, an "Administrator" badge. Footer: "Turn a library on for someone to let them see its photos. Turn it off to hide it from them again. Administrators also need to turn it on for themselves." On phone the matrix is replaced by the per-user list (iOS has no wide tables).
- Empty states: no libraries: "Add a library first." with a button; no non-admin users: "Only administrators exist. Invite someone to share a library."
- Toggling off needs no confirmation (it is reversible and instant); toggling off the last person on a library shows an inline note "No one can see this library now."

### 2.4 Sessions ("Devices")

Group per person (section header = username) of rows:
```
iPhone · Safari                           Active now   ·  This device
MacBook · Chrome                          3 days ago
```
- Device: parse the `device` string to "Browser on System" once on the client (fallback "Unknown device"); keep raw string in the tooltip.
- Value: relative last seen. Secondary line: "Signed in 4 Nov · Stays signed in until 4 Dec" (from `created_at`, `expires_at`), plus "Remember me" shown as "Stays signed in on this device" if `remember_me`.
- Action: swipe or detail → red **Sign Out**; no confirm for another person's device (it is recoverable: they just sign in again), but a confirm with a warning if it is *your own* session or the only admin session: "You'll be signed out of this admin panel."
- Footer: "Signing a device out ends its session right away. The person can sign in again with their password."
- Empty: "No one is signed in." (cannot happen for an admin, so no copy needed; keep a generic one).
- Needs `is_current` on the session (server) to mark "This device" (issue F).

Copy for Sign Out (formerly Revoke): "Ends this sign-in. Use it when a phone is lost or someone shouldn't have access any more."

### 2.5 Activity ("Audit log")

- Filters: a single "Filter" row group: **Person** (menu of names, with "Everyone"), **Library** (menu of names, with "All"), **From** / **To** dates. Replaces User id and Library id fields. Names come from the already-available access matrix.
- Entries as rows: icon, sentence, time. A mapping from action code to sentence: `login` "pp signed in"; `add_library` "pp added the library Family"; `remove_library` "pp removed the library Family"; `rename_library` "pp renamed a library to Family"; `create_user`/`delete_user`/`unlock_user`/`unlock`; `revoke_session` "pp signed out Anna's iPhone"; `set_settings` "pp changed settings"; `set_tailnet_allowlist` "pp changed who can reach the app"; `osm_consent_agreed`/`osm_consent_withdrawn`/`osm_consent_not_now` "pp allowed / turned off map and place names"; `prewarm.*` "Thumbnails prepared / paused / deleted for Family"; `library.check_now`, `library.file_missing`. Unknown codes fall back to the raw action in a neutral style. The `detail` field (raw `id=3 display_name=...`) is hidden behind a disclosure "Details".
- "Load more" at the bottom using `offset` (already supported by the API).
- Export CSV: a button row "Export as CSV…" with footer "A spreadsheet of this list, with the filters applied."
- Empty state: "Nothing here yet. Sign-ins, downloads and changes will appear here." Filtered empty: "Nothing matches these filters." with "Clear Filters".
- Footer on the page: "A record of who did what, kept so you can see if something looks wrong."

### 2.6 Settings

Group the 14 settings by meaning, not by implementation. Each row has an (i) (#268). Human units: numeric fields become a value + unit chooser or a stepper/select of sensible presets.

**Signing in** (footer: "How long people stay signed in before they have to enter their password again. Shorter is safer on shared computers. Changes apply to new sign-ins.")
- "On computers" `session_lifetime_desktop_seconds`, a menu: 1 hour, 4 hours, 12 hours (default), 1 day, 7 days, Custom…
- "On the home-screen app (iPhone)" `session_lifetime_pwa_seconds`, menu: 1 day, 7 days, 30 days (default), 90 days, Custom…
- "When 'Stay signed in' is ticked" `session_lifetime_remember_me_seconds`, menu: 30 days, 90 days, 180 days (default), 1 year, Custom…
- "Custom…" opens an input with a unit select (minutes, hours, days) that converts to seconds; minimum 1 minute (server `ge=60`). A stored value that is not a preset shows as "Custom: 3 days 4 hours". Question 5 asks whether to drop Custom.
- (i) example: "Desktop: 12 hours is a working day. People on the home-screen app are asked less often, because typing a password on a phone is a chore."
- Consequence: does a change sign people out? Unknown whether existing sessions are re-evaluated (section 6).

**Downloads** (footer: "Limits on what people can download.")
- "Largest download at once" `zip_size_limit_bytes`: input in GB (decimal allowed, 0.1 steps) or preset menu 500 MB, 1 GB, 2 GB (default), 5 GB, 10 GB, Custom. Convert with 1024-based GB to match the existing 2 × 1024³ default. (i): "When someone downloads many photos at once they arrive as one ZIP file. This is the largest size allowed. Bigger limits can use more disk space and take longer."

**Thumbnails** (footer: "Thumbnails are small preview pictures. Better quality looks sharper but takes more space and loads more slowly. The defaults suit most people.")
- Merge the three sizes into one row "Picture detail" with presets: Standard (defaults), High, Custom… (the three numbers appear only under Custom, relabelled "Grid", "Grid on sharp screens (2×)", "Full-screen preview", all in "pixels wide"). Show an "Reset to Defaults" row.
- "Quality" `thumb_quality`, a slider with labels Smaller files … Sharper, with the numeric value shown (1 to 100; default 82).
- "Space for thumbnails" `media_cache_size_limit_bytes` (the missing field): menu 1 GB, 5 GB (default), 20 GB, 50 GB, Custom. Footer: "When this fills up, the oldest thumbnails are removed first." (verify eviction behaviour in `media.py`.)
- Changing sizes or quality: does it invalidate cached thumbnails? State the consequence in the (i) once verified.

**Libraries** (footer: "The app checks your libraries for changes, for example when you copy new photos into one.")
- "Check for changes" `library_check_interval_minutes`: menu Every 5 minutes, 15 minutes (default), Every hour, Every day, Never (checks only when you press Check Now), Custom…. 0 maps to "Never" and replaces the separate "Manual only" checkbox.
- "Wait until a library stops changing" `library_stable_minutes`: menu No wait, 5 minutes, 10 minutes (default), 30 minutes, 1 hour, Custom…. (i): "While you are copying a large library the files change for a long time. The app waits this long after the last change before it reads the library, so it doesn't read a half-copied one."
- "Tell people when a library was updated" toggle; (i): "Shows a small note to people when their library has just been updated."
- Action row: **Check All Libraries Now**, with the same copy as "Check for changes now" above plus "A library that is still changing waits for the wait time above."

**Map and place names** (reorganised; the consent text itself is a product decision and lives in `MAP_PLACE_NAMES_TEXT`, which should not be reworded here without pp's agreement, so only structure is proposed)
- Toggle "Show maps and place names" (`osm_consent`), with a footer using the existing text. Below, a row "Place-name data" with status "Downloaded (2.1 MB)" / "Not downloaded" and a button "Download" / "Download Again" (disabled with a footer "Turn on above first" when no consent). A row "Offline map file" for the optional PMTiles path, which becomes a file choice from a list (reuse the picker approach with `/tiles` in Docker; see 3.5). Jargon to remove: "PMTiles", "GeoNames", "cities15000", "tile.openstreetmap.org" go in the (i) as one sentence, not in the page body.

**Who can reach the app** (the "Tailnet allow-list"; footer: "Leave this empty to let everyone on your private network use the app. Add names to limit it to specific people.")
- Rename to something like "Allowed devices and people". The textarea of identities stays, but each line is added through an "Add…" row with a field and rendered as a removable list (rows with a red minus). Footer warns: "Be careful not to remove yourself. The app will refuse a list that would lock you out." (matches the existing server check.) (i) explains "Tailscale name, e.g. anna@example.com".
- Question 6: whether to show this to non-technical admins at all.

Saving model: iOS-style **instant save per row** (like System Settings) is simplest to reason about but causes N writes and PUTs the whole settings object today (`PUT /api/admin/settings` requires every field). Recommendation: keep one PUT and keep the submit model, but make it a sticky "Save Changes" bar that appears only when something changed, and a single "Saved" confirmation; the allow-list and place-name download remain separate immediate actions. (A `PATCH` with partial fields would allow instant save; see issue F.)

---

## 3. Library picker

### Is a new endpoint needed?
Yes. Nothing today lists directories. The closest code is `_suggest_replacements` in `library_admin.py`, which lists `.photoslibrary` siblings of a *missing registered* path, and `docker-compose.yml`, which mounts `${PHOTOS_LIBRARY_DIR:-./libraries}:/libraries:ro`. There is no server-side notion of a "libraries root", so one has to be introduced.

### Configuration
- New environment variable `PHOTOS_VIEWER_LIBRARIES_DIR` (Docker default `/libraries`, set in `deploy/docker-compose.yml` and `.env.example`). Several roots may be allowed, separated with `os.pathsep` (same convention as `PHOTOS_VIEWER_REFERENCED_ROOTS`, `library_assets.py:752`). Unset means "no picker": the endpoint returns `{"roots": [], "libraries": []}` and the UI shows the typed-path fallback with the help text. On a Mac install without Docker an admin can set it to e.g. `/Volumes/Photos`.
- A natural place for macOS is the same variable in the launchd plist.

### Endpoint
`GET /api/admin/library-candidates` (admin only; `require_admin`; a GET, so no CSRF dependency, matching `list_libraries`).

Response:
```json
{
  "roots": ["/libraries"],
  "root_configured": true,
  "root_reachable": true,
  "candidates": [
    {
      "name": "Family.photoslibrary",
      "path": "/libraries/Family.photoslibrary",
      "modified_at": "2026-11-10T08:12:00Z",
      "registered": false,
      "library_id": null,
      "readable": true
    }
  ]
}
```
Notes:
- `path` is returned because the existing `POST /api/admin/libraries` takes a path; the UI never shows it (only `name`). Alternative: return an opaque `id` (the name relative to the root) and add `root_relative_name` to the POST body so the server resolves the path itself. That removes the arbitrary path from the add flow entirely when the picker is used. Recommend the second form: `POST /api/admin/libraries` accepts either `path` (typed, advanced) or `candidate` (the relative name). Simpler for a first version: keep `path`.
- `registered` and `library_id` are computed with `_registered_paths(db)` (resolved paths), as `_suggest_replacements` does.
- No version check and no opening of any database in the listing (that would cost a temp copy per bundle; `libraries.open_library_readonly` copies the sqlite files). Validation stays in `add_library` via `_validate_library_path`. An optional, cheap `readable` flag from `os.access` and `database/Photos.sqlite` existence is fine (stat only, as in `_suggest_replacements`).
- Size is not returned (a walk of a multi-terabyte package must not happen in a list call).

### Security limits
- Only entries directly inside a configured root are listed (depth 1; no recursion, nothing like a directory browser). Not a general file browser, which would let the admin UI explore the whole filesystem.
- Resolve each entry with `Path.resolve()` and keep it only if it is inside the resolved root (`resolved.is_relative_to(resolved_root)`) so a symlink to elsewhere (e.g. `/libraries/x.photoslibrary -> /etc`) is skipped (or shown as "Can't be used" without a path).
- Require suffix `.photoslibrary` and `is_dir()`; skip names starting with `.`; cap the result (e.g. 200) and sort by name.
- The client sends no path to this endpoint, so there is nothing to traverse. If a `candidate` parameter is added to `POST`, it must be a single path component: reject `/`, `\`, `..`, NUL, and absolute values, join to the root, resolve, then re-check `is_relative_to(root)` before calling `_validate_library_path`. Return 400 with the generic message "That library is not in the libraries folder" (do not echo other filesystem state).
- Read-only: `iterdir()` and `stat()` only, never `open()` of a database (consistent with CLAUDE.md: only `libraries.py` may open a `.photoslibrary`; the listing touches only the *parent* directory, as `_suggest_replacements` already does, but put the helper in `library_admin.py` next to it, or a new small module, not in `libraries.py`).
- Errors from `iterdir` (unmounted drive, permission) map to `root_reachable: false` so the UI can say "The libraries folder can't be read. Is the drive connected?" instead of a 500.
- Admin only, and for non-admins the existing `require_admin` gives 403, consistent with the access-control test in CLAUDE.md. No new audit entry for listing; the add call already audits.
- Typed-path fallback remains for installs without the variable; it keeps today's validation (resolve first, then suffix and `Photos.sqlite` checks). Should the typed path *also* be forced inside the root when a root is configured? Question 3.

### Replace dialog and PMTiles
The same helper serves Replace ("choose the new file", with the current `suggestion` pinned first), so the ReplaceDialog no longer needs a typed path. The Docker mount for PMTiles is `/tiles` (compose file); a sibling `GET /api/admin/map-files` (or one endpoint with a `kind` parameter) listing `*.pmtiles` in `PHOTOS_VIEWER_TILES_DIR` can follow later with the same rules. Not needed for the first iteration.

---

## 4. Shared control spec

Today (`admin.css`): inputs, selects, textareas and buttons all use `padding: var(--space-6) var(--space-10|14)`, `font: inherit`, and border-radius `--radius-8`. Input and select have a 1px border, buttons have none; so a button next to an input in the same row is 2px shorter, and `select` heights differ per browser. Phone changes only input font size. Table action buttons are smaller still (`3px` padding, caption size).

Proposed tokens (add to `admin.css` using the existing space/radius tokens; if the project has a control-height token already in `tokens.css` reuse it, I did not verify):

| Element | Desktop | Phone (≤700px) | Style |
| --- | --- | --- | --- |
| Text/number/password input, select | height 32px (`min-height`), padding 0 10px | height 44px | 1px `--color-line` border, radius 8, `--color-bg-grouped` fill; font `inherit`; phone font 16px (stops iOS zoom, already done) |
| Textarea | min-height 4 rows, same padding/border | same | same |
| Primary button | 32px, padding 0 14px | 44px | accent fill, white text, radius 8, weight 600 |
| Secondary button (default) | 32px | 44px | `--color-fill-subtle` fill, accent text |
| Destructive button | 32px | 44px | danger text on `--color-fill-subtle`; filled danger only inside a confirm dialog's final button |
| Text/link button (`admin-link`) | inherits | 44px target | accent text, no fill |
| Row action (in lists) | whole row is the target, min-height 44px | same | no per-row button chrome; chevron or accent text |
| Switch (toggle) | 51×31 (iOS) or 38×22 (macOS) | iOS | replaces 18px checkboxes in rows |
| Info (i) | 20px visible, 28px hit area desktop; 44px hit area phone | | secondary colour, from #268 |
| Focus | 2px accent outline, offset 1px (existing) | | keep |
| Disabled | 40% opacity, `cursor: not-allowed`, no hover | | one rule for all |
| Danger/alert text | `--color-danger-text` | | existing |

Implementation approach: define `.admin-control` variables (`--admin-control-h: 32px; --admin-control-h-touch: 44px`) and apply to `input:not([type=checkbox],[type=radio]), select, button` under `.admin-app`. Use `box-sizing: border-box` and `display: inline-flex; align-items: center` so buttons and inputs line up. Put `button` base style in one rule (today it is split between `.admin-main button`, `.admin-nav button`, `.admin-actions button`, `form > button[type=submit]`, `.admin-link`).

Existing tests to keep in mind: `AdminApp.styles.test.tsx` asserts specific class names and a `.admin-actions` 2-column grid rule at ≤700px; the Users table rework will need that test updated or replaced. `cssColours.test.ts` / `cssMotion.test.ts` presumably lint tokens in CSS (not read); new CSS must go through them.

---

## 5. Implementation issues (ordered)

"Server" marks issues that need server changes. Each is meant to be a small PR.

**A. Admin design system: shared controls, groups, rows, dialog, formatters (no server).**
Scope: `admin.css` control spec (section 4); `GroupedList`, `Row`, `Footer`, `Switch` components; a `Sheet` dialog (focus trap, Escape, red/neutral actions) replacing `prompt`/`confirm`; `formatWhen`, `formatBytes`, `formatDuration` helpers with unit tests; a toast/inline "Saved" status; skeleton row. Keep current screens working (migrate none).
Acceptance: one screenshot page (extend `IconGallery` style or a dev-only route) shows all controls at 32px/44px; unit tests for the three formatters (including UTC handling, past/future, singular/plural, 0 and huge values); no behaviour change on existing screens; `npm test` passes; `AdminApp.styles.test.tsx` updated.

**B. InfoButton and popover, shared with #268 (no server).**
Scope: the (i) component and tooltip/popover; a `help` text registry (`adminHelp.ts`) so copy lives in one file. Coordinate with the #268 implementer; do it once.
Acceptance: keyboard focus, hover and tap open it; `aria-label="About <name>"`, `aria-describedby`; test that every row registered with a help key renders non-empty text.

**C. Library picker endpoint (Server).**
Scope: `PHOTOS_VIEWER_LIBRARIES_DIR` setting, `.env.example`, compose and launchd docs; `GET /api/admin/library-candidates` per section 3; `candidate` form of `POST /api/admin/libraries` (optional second step).
Acceptance: admin-only (403 for non-admin, 401 unauthenticated); lists only `*.photoslibrary` directories at depth 1 inside the root; symlinks pointing outside the root, dotfiles and files are omitted; registered ones flagged; unreachable or unset root returns the documented shape, not a 500; no database is opened; tests build a temp root with a fixture, a symlink escape, a regular file named `.photoslibrary`, and an unreadable directory.

**D. Libraries list + detail page, Add and Replace via picker (web; needs C for the picker, otherwise ships with the typed-path fallback).**
Scope: sections 2.1 and 3; status words; automatic status loading; rename inline; remove, delete-cache and replace sheets with the copy above; history in plain words; friendly empty state with the "how to mount" help; Replace uses the picker with the server's suggestion first.
Acceptance: no raw ISO timestamps, no byte counts, no full path in the list; every action has an (i) with the copy above; `Remove` and `Delete cache` confirm via the sheet, not `window.confirm`; existing `LibrariesScreen`, `PrewarmControls` and `ReplaceDialog` tests are ported and still cover the same behaviour; phone layout at 390px has no horizontal scroll.

**E. Settings screen regroup with human units (web, no server for the first cut).**
Scope: section 2.6 groups; presets plus Custom for lifetimes, zip limit, check interval, wait time and cache size; add the missing `media_cache_size_limit_bytes` row; fold "Manual only" into the interval menu; (i) on every row (uses B); one sticky Save bar; PMTiles path kept as a text field until a file picker exists.
Acceptance: no "seconds", "bytes", "PWA", "PMTiles" or "tailnet" visible outside an (i); round-trip tests: a stored 43200 shows "12 hours", saving a changed preset sends the exact seconds/bytes the server expects (1 GB = 1024³); invalid Custom values are blocked with an inline message; the `#map-place-names` deep link still scrolls to its group; existing SettingsScreen tests updated.

**F. Small admin API additions (Server).** Independent, each optional and shippable alone:
1. `is_current` boolean on `GET /api/admin/sessions` (compare to the request's session).
2. Cache size per library in `LibraryStatusResponse` (e.g. `thumbnail_cache_bytes`) so the delete confirm can say "about 1.2 GB".
3. `locked` boolean on users (for showing "Unlock" only when relevant).
4. `DELETE /api/admin/invites/{id}` to cancel an open invite (an audit entry too).
5. A way to list audit actions grouped, or accept `user`/`library` names; not needed if the UI uses ids from the matrix.
6. `PATCH /api/admin/settings` with a partial body (for instant save).
7. A batch status endpoint `GET /api/admin/libraries/status` (all libraries in one call) if per-row status fetching is slow.
Acceptance per item: tests including 403 for non-admins and unchanged behaviour of existing routes.

**G. Users and Sharing (web; uses F1 to F4 when present).**
Scope: sections 2.2 and 2.3: user list/detail, role sheet, Change Password sheet with confirm field, invitations with Copy, per-library/per-user toggles, restyled matrix with switches (desktop) and per-user list (phone).
Acceptance: no `window.prompt`/`confirm`; delete confirm names the user; demoting or disabling yourself is blocked or warned; the existing access-control tests still pass (server untouched except F); a11y labels on every switch; empty states as written.

**H. Devices (Sessions) and Activity (Audit log) (web; F1 helps).**
Scope: sections 2.4 and 2.5: grouped session list with parsed device names and relative times; Sign Out; activity sentences with a code-to-sentence map and fallback, name-based filters, "Load more" via `offset`, CSV button.
Acceptance: unit test that every action code the server writes (see list in section 1) maps to a sentence and unknown codes fall back safely; user and library filters are menus of names; paging loads further entries; no raw timestamps.

**I. Navigation and shell polish (web).**
Scope: icons in the sidebar, renamed sections (if agreed), hash routing for detail pages (`#libraries/3`), back links, phone push-navigation behaviour, banner for the "Map & place names" opt-in restyled as a grouped notice.
Acceptance: browser back works between list and detail; deep link `#map-place-names` still works; no regression in `AdminApp.test.tsx`.

Suggested order: A → B → C (server, can run parallel with A/B) → D → E → F (as needed) → G → H → I. D and E give the biggest visible change for pp; if only two things ship, ship those.

---

## 6. Open questions for pp

1. Should the section names change to everyday words (Users → People, Access → Sharing, Sessions → Devices, Audit log → Activity), or keep the current names so they match the docs?
2. For Settings, do you want each change to save instantly (like iPhone Settings), or one "Save" button that appears when something changed (my recommendation, because several fields belong together)?
3. If the libraries folder is set up, should the typed path stay available under "Advanced", or should adding a library only be possible from that folder? (Typed path is more flexible; folder-only is safer and simpler.)
4. How is the library folder connected on the Mac (not Docker)? Is it always one folder, such as an external drive, or are libraries scattered? That decides whether one folder setting is enough.
5. Is a free "Custom" value needed for things like how long people stay signed in, or are a few ready choices (1 hour, 1 day, 30 days…) enough? Fewer choices means fewer ways to set something unsafe.
6. Should the "who can reach the app" list (the Tailnet allow-list) be visible to every admin, or hidden under an "Advanced" section since a mistake can lock people out?
7. Is "Ready · 20 photos" the right summary on a library row, or would you also like the size on disk (e.g. "412 GB") there?
8. Should removing a person's access, or signing out a device, ask "Are you sure?" or just happen right away (it is easy to undo)? I proposed: no question for those, a question for deleting a user, removing a library, and deleting the thumbnail cache.
9. May the admin's own account be demoted, turned off or signed out from this panel, or should the app stop that to avoid locking yourself out?
10. Thumbnail picture size and quality: do you want to keep these visible at all, or hide them behind one "Picture quality: Standard / High" choice with the numbers only in "Custom"?
11. Is the order of the proposed issues right, with Libraries and Settings first?

---

## What is not verified

- No browser was opened. Nothing here has been seen rendered; layout, heights and phone behaviour are inferred from `admin.css` and the TSX only.
- I did not run the tests or the server.
- Unconfirmed server behaviours I flagged inline: whether the server stores timestamps in UTC without a zone marker (affects `formatWhen`); whether changing a password revokes sessions; whether lifetime changes affect existing sessions; whether thumbnail size/quality changes invalidate cached thumbnails; how the thumbnail cache size limit evicts; the invite expiry (7 days is an assumption; only `expires_at` is shown in the code I read); whether a control-height token already exists in `shell/tokens.css`.
- The `device` field format (raw user agent vs. pre-parsed) was not checked, so the parsing in 2.4 may be unnecessary.
- `cssColours.test.ts` and `cssMotion.test.ts` were not read; new CSS may have to satisfy them.
