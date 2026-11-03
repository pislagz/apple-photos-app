# Design references

Screenshots of iOS 17 Photos and macOS Sequoia Photos. They are layout references for spacing, type, materials, and hierarchy. The app uses its own icons, its own font stack (`system-ui`), and the tab bar and sidebar described in `docs/SPEC.md`.

These files stay in this folder. The web app does not import them. They are not a sample photo library. Some of the Mac shots show personal pictures; treat the folder as documentation, and do not add more personal photos to the repo.

Apple's iOS 17 tab bar is Library, For You, Albums, and Search. This app's mobile bar is Library, Albums, More, and Search: there is no "For You" equivalent, since Apple's Memories and Featured Photos are curated by Apple and aren't in the library. People & Pets, Places (the map), and Media Types move into the More tab instead of each getting a top-level tab; Albums holds only user-created (and shared) albums. For You, Memories, Featured Photos, Trips, Recently Deleted, Projects, and Shared Albums show up in the shots and are out of scope. Edit, trash, and favorite-as-a-write are out of scope. A heart may display the existing favorite flag.

## Sidebar order: 15.0 and 15.4

`sequoia-library-grid.png` is the macOS 15.0 sidebar. `sequoia-trips.jpg` is the macOS 15.4 sidebar. `sequoia-days-collection.jpg` and `sequoia-people-pets.jpg` match the 15.4 Photos group. The two cropped sidebar images match 15.4 as well.

Build the sidebar in the spec: library switcher, Library, Favorites, Recently Saved/Added, Map, People, Media Types (Videos, Selfies, Live Photos, Portrait, Panoramas, Screenshots, RAW), the album folder tree, smart albums, and the account menu. Use the screenshots for row height, icon weight, and group labels.

**15.0**, top to bottom, from `sequoia-library-grid.png`:

- Photos: Library (selected), Recently Saved, Map
- Collections: Days, People & Pets, Memories, Trips, Featured Photos
- Albums (expanded): Wallpapers
- Utilities (expanded): Recently Deleted (lock), Duplicates, Recently Saved, Imports
- Projects (collapsed)
- Sharing: Shared Albums (collapsed)

Favorites is not in the 15.0 Photos group. Recently Deleted sits under Utilities. Media Types is not on screen.

**15.4**, from `sequoia-trips.jpg`:

- Photos: Library, Favorites, Map, Recently Saved, Recently Deleted (lock)
- Collections: Days, People & Pets, Memories, Trips (selected), Featured Photos
- Utilities (expanded): Documents, Duplicates, Handwriting, Hidden (lock), Illustrations, Imports, Receipts, Recently Edited, Recently Viewed, Recently Shared
- Media Types (expanded, cut off): Animated, then the window ends

The rest of Media Types is below the fold and is not in the image. Albums, Projects, and Sharing are not in this crop.

## Images

### `ios17-library-days.png`

828×998. Support-article figure: an iPhone on a white page, with the callout "Tap to navigate Photos." pointing at the tab bar.

Library tab, Days zoom. Status bar 9:41, Dynamic Island. A full-width photo carries the pinned header "Sep 5, 2022" and the place "Lloyd Harbor", with a Select button and a more button at the top right of the photo. Under it, a row of three square thumbnails, then another wide photo. A floating pill reads Years, Months, Days (selected), All Photos. The translucent tab bar is Library (selected, blue), For You, Albums, Search.

Spec screens: mobile Library, the Years/Months/Days/All Photos control, and the pinned date header. Days is the mixed hero-and-squares layout. All Photos, Years, and Months are not separate shots.

### `ios17-people-pets.png`

490×998. Phone only, no callout.

Pushed from Albums: back button "Albums", title "People & Pets", Select, and a sort button. Two-column grid of circular portraits with names underneath: Brian, Angie, Ryder (a dog), Louis, Tyler, Gabriela. Each circle has a blue heart badge. Tab bar has Albums selected. White background.

Spec screen: mobile People. In iOS 17 this screen lives under Albums; in this app it is pushed from the More tab instead, at its own stable route (`/people`) so it can move again later at little cost. The circles, names, and heart badge are the visual target. Renaming people is out of scope.

### `ios17-viewer.png`

806×998. Support-article figure. Callout: "Swipe to browse through your photos." pointing at the filmstrip.

White chrome, not a black full-bleed viewer. Back chevron, centered place title "Leo Carrillo State Beach", subtitle "August 15, 2022 7:48 PM", blue Edit, blue more button. The photo is letterboxed. A thumbnail filmstrip sits underneath, one cell emphasized. Bottom toolbar: share, heart, info, trash.

Spec screen: mobile viewer. Keep the filmstrip, the place-and-date title, and the info button. Drop Edit and trash. Share in our app is download / Save to Photos, not iCloud sharing. Swipe, pinch, and swipe-down-to-dismiss are specified even though this still frame only shows the filmstrip.

### `sequoia-sidebar-top-level.png`

406×380. The Photos group alone, on the sidebar gray.

Library, Favorites, Map, Recently Saved, Recently Deleted with a lock. Blue template icons. This is the 15.4 Photos group.

Spec screen: desktop sidebar, the top group. Our group is Library, Favorites, Recently Saved/Added, Map, then People. Recently Deleted is out of scope.

### `sequoia-sidebar-collections.png`

410×380. The Collections group alone.

Days, People & Pets, Memories, Trips, Featured Photos. Same five names in 15.0 and 15.4.

Spec screen: desktop sidebar rhythm for a group. Memories, Trips, and Featured Photos are out of scope. People is in our sidebar. Days on the Mac is a collection; our desktop Library uses Years, Months, and All Photos in the toolbar instead.

### `sequoia-library-grid.png`

2624×1664. Full window on a black desktop. This is the 15.0 sidebar order listed above. Library is selected.

Toolbar, left to right: sidebar toggle, zoom slider, segmented Years / Months / All Photos (All Photos selected), Info, Share, heart, Rotate (a square with a curved arrow), Search. Content is aspect-ratio tiles in rows of even height, abstract wallpapers, with the range "Apr 13, 2021 – Jun 11, 2024" overlaid on the first row in white. A "Filter By: All Items" menu sits at the top right of the content. The footer reads "46 Photos" and "Synced with iCloud Just Now".

Spec screen: desktop Library grid and toolbar. Our toolbar is the segmented control, zoom, search, download, and Info. We do not show an iCloud sync line. The aspect-ratio grid is the reference for that mode. Square crops are also allowed by the spec. Rotate, share-to-iCloud, and the favorite button as a write are out of scope. The heart on hover may show the existing flag.

### `sequoia-trips.jpg`

2560×1516. macOS 15.4 sidebar, Trips selected. Media Types is cut off after Animated.

Content title "Trips", "70 items". The toolbar shows the zoom slider, and the section context is Collections. A horizontal scroller of year chips starts with All (filled blue) and runs off the right edge through the 2000s. Cards are a rounded photo, a place line, and a month-year line, four columns visible: East Syracuse & Ottawa (Feb 2025), Redwood City & San Francisco (Dec 2024), Salt Lake City (May 2024), Redwood City (Dec 2023), Perry (May 2023), Niagara Falls (Dec 2022), Fairport (Nov 2022), Athens & Imerovigli (Oct 2022).

Spec screen: not a product screen. Trips are out of scope. Use it for the 15.4 sidebar, the card grid, the year chips, and the count under a large title.

### `sequoia-days-collection.jpg`

2530×1050. Two windows stacked in one file, both on the 15.4 sidebar with Days selected.

Top: title "Days", "1,322 items", three large rounded cards labeled Mar 20, Mar 2, and Feb 23. The Feb 23 card has a blue selection ring.

Bottom: title "Ottawa", subtitle "February 2025", "6 Photos", a Play Slideshow link, and one horizontal row of six photos.

Spec screen: closest reference for a day or month group opened as large cards, and for a filmstrip of one day. Slideshow is out of scope. Desktop Library itself uses Years / Months / All Photos, as in `sequoia-library-grid.png`.

### `sequoia-people-pets.jpg`

2560×440. A short, wide crop, not a full window. 15.4 sidebar, People & Pets selected, Collections visible through Featured Photos.

Title "People & Pets", "162 items". A Groups row of landscape cards with names under them: "Adam, Tonya, and Tristan", "Adam and Tonya", "Adam and Tristan", "Adam and Oliver", and a selected card. The context menu on the selected card reads Get Info, Play Slideshow, Add People…, Remove People…, Remove This Group. A Create button sits at the right of the Groups heading. The zoom slider is in the toolbar.

Spec screen: desktop People, partially. The spec's People view is a grid of circular faces, which the iOS shot shows and this Mac shot does not. This file is the Groups row and the context-menu styling. Get Info is in-scope as read-only metadata. Slideshow, Add People, Remove People, Remove This Group, and Create are writes and are out of scope.

## Missing references

These screens are in the product and are not in the image set. Use Apple's guides, version-pinned where a 17.0 or 15.0 URL exists.

| Missing screen | Guide |
| --- | --- |
| iOS 17 Albums tab (My Albums, media types, folders) | [Use photo albums in Photos on iPhone](https://support.apple.com/guide/iphone/use-photo-albums-iphc0fc668ab/17.0/ios/17.0). Albums is a bottom tab. The page also points at People and Places from that tab. |
| iOS 17 Places map | [Browse photos by location on iPhone](https://support.apple.com/guide/iphone/browse-photos-by-location-iph390138909/17.0/ios/17.0). Albums → Places → Map or Grid. Pinch and drag. Only items with GPS. |
| iOS 17 info panel | [View photos and videos in Photos on iPhone](https://support.apple.com/guide/iphone/view-photos-iph3d267610/17.0/ios/17.0), section "See photo and video information". Open a photo, tap the info button or swipe up: people, date, camera metadata, map. The location guide's "See where a photo was taken" is the same sheet. |
| Mac Info window (version 15) | [See photo and video information in Photos on Mac](https://support.apple.com/guide/photos/see-photo-and-video-information-phta8b25fa42/15.0/mac/15.0). Select a photo, click Info, or press Command-I. People, date, camera, file size, location, albums. |
| Mac Map view (version 15) | [Find photos and videos by location on Mac](https://support.apple.com/guide/photos/find-photos-and-videos-by-location-pht4c00b8ddc/15.0/mac/15.0). Map in the sidebar, or Places inside the Info window. Clustered thumbnails, zoom, Map / Satellite / Grid. |

The Mac guide home, with the version picker set to 15: <https://support.apple.com/guide/photos/welcome/mac>.

The iOS 17 overview that names the real tab bar (Library, For You, Albums, Search) and the Years / Months / Days / All Photos behavior: <https://support.apple.com/guide/iphone/view-photos-iph3d267610/17.0/ios/17.0>.

Also not in the set, and not required as extra downloads: iOS Years, Months, and All Photos as their own figures; the iOS Search tab; Mac Years and Months; a Mac grid of individual circular faces; an expanded album tree beyond the single Wallpapers album. The spec text and the guides above cover them.
