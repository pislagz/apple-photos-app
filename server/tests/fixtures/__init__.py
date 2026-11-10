"""Builds a tiny synthetic `.photoslibrary`-shaped package for tests.

No personal photos. No file copied from a real Mac library. Every table and
column name matches what osxphotos 0.77.2's Photos-5 code path reads from
`database/Photos.sqlite` (`osxphotos.photosdb.photosdb.PhotosDB._process_database5`
and the per-module `_process_*` helpers it calls, plus
`osxphotos._constants._DB_TABLE_NAMES[5]`), closely enough for `PhotosDB` to
open the library without error.

`ZGENERICASSET` has one real asset row, with a matching file under
`originals/` and a `ZADDITIONALASSETATTRIBUTES` row, so `len(PhotosDB(...))`
and the asset-scoped routes have something to return. That file is a real,
tiny HEIC-encoded image (via `pillow_heif`'s write support), not placeholder
bytes -- the P1.7 media backend tests decode it the same way a real library's
asset would be decoded. Every *other* row this
asset's processing could join to (`ZMOMENT`, `ZUNMANAGEDADJUSTMENT`,
`ZASSETDESCRIPTION`, `ZCLOUDMASTER`, ...) is deliberately left absent --
those joins are plain `JOIN`s in `_process_database5`, so an asset with no
matching row in them just gets `NULL` for that enrichment, not an error. The
two rows that matter regardless of asset count are `Z_METADATA`, which needs
a plist osxphotos can read the Photos model version out of, and
`ZGENERICALBUM`, which needs exactly one "root folder" row (`ZKIND` = the
root-folder sentinel, `ZPARENTFOLDER` = NULL) -- `PhotosDB.__init__` looks
that row up unconditionally and raises if it's missing or not unique.

`search/psi.sqlite` has the three tables `_process_psi_searchinfo` joins
(`ga`, `groups`, `assets`), all empty, so osxphotos finds a search index
instead of logging "could not find search db" -- see `_copy_search_index` in
`photos_viewer/libraries.py` for why the copy has to land next to the copied
database, not next to the package's own `database/search/`.

The asset's favorite flag is flipped on afterwards through a real,
uncheckpointed WAL write (see `_write_uncheckpointed_wal_change` below), so
`-wal` holds genuine committed-but-unmerged content, not an empty
placeholder, for tests that exercise WAL replay through the copy step.
"""

from __future__ import annotations

import dataclasses
import io
import pathlib
import plistlib
import shutil
import sqlite3
from collections.abc import Sequence

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()

# osxphotos._constants._PHOTOS_5_MODEL_VERSION == [13000, 13999]: the Core
# Data model version range Photos 5 (macOS 10.15 Catalina) libraries use.
_MODEL_VERSION = 13537

# osxphotos._constants._PHOTOS_5_ROOT_FOLDER_KIND
_ROOT_FOLDER_KIND = 3999

_SCHEMA = """
CREATE TABLE Z_METADATA (Z_VERSION, Z_PLIST, Z_UUID);

CREATE TABLE ZGENERICALBUM (
    Z_PK, ZUUID, ZTITLE, ZCLOUDLOCALSTATE, ZCLOUDOWNERFIRSTNAME,
    ZCLOUDOWNERLASTNAME, ZCLOUDOWNERHASHEDPERSONID, ZCLOUDOWNERFULLNAME,
    ZKIND, ZPARENTFOLDER, ZTRASHEDSTATE, ZCREATIONDATE, ZSTARTDATE,
    ZENDDATE, ZCUSTOMSORTASCENDING, ZCUSTOMSORTKEY
);

CREATE TABLE ZGENERICASSET (
    Z_PK, ZUUID, ZMODIFICATIONDATE, ZDATECREATED, ZHIDDEN, ZFAVORITE,
    ZDIRECTORY, ZFILENAME, ZLATITUDE, ZLONGITUDE, ZHASADJUSTMENTS,
    ZCLOUDBATCHPUBLISHDATE, ZKIND, ZUNIFORMTYPEIDENTIFIER, ZAVALANCHEUUID,
    ZAVALANCHEPICKTYPE, ZKINDSUBTYPE, ZCUSTOMRENDEREDVALUE,
    ZCLOUDASSETGUID, ZMOMENT, ZTRASHEDSTATE, ZHEIGHT, ZWIDTH, ZORIENTATION,
    ZDEPTHSTATES, ZADJUSTMENTTIMESTAMP, ZVISIBILITYSTATE, ZTRASHEDDATE,
    ZSAVEDASSETTYPE, ZADDEDDATE, ZCLOUDOWNERHASHEDPERSONID, ZMOMENTSHARE,
    ZMASTER, ZIMPORTSESSION, Z_FOK_IMPORTSESSION, ZOVERALLAESTHETICSCORE,
    ZCURATIONSCORE, ZPROMOTIONSCORE, ZHIGHLIGHTVISIBILITYSCORE
);

CREATE TABLE ZADDITIONALASSETATTRIBUTES (
    Z_PK, ZASSET, ZTITLE, ZORIGINALFILENAME, ZTIMEZONEOFFSET,
    ZINFERREDTIMEZONEOFFSET, ZTIMEZONENAME, ZCAMERACAPTUREDEVICE,
    ZREVERSELOCATIONDATA, ZORIGINALRESOURCECHOICE, ZMASTERFINGERPRINT,
    ZORIGINALHEIGHT, ZORIGINALWIDTH, ZORIGINALORIENTATION,
    ZORIGINALFILESIZE, ZUNMANAGEDADJUSTMENT, ZASSETDESCRIPTION
);

CREATE TABLE ZPERSON (
    Z_PK, ZPERSONUUID, ZFULLNAME, ZFACECOUNT, ZKEYFACE, ZDISPLAYNAME,
    ZTYPE, ZMANUALORDER
);

CREATE TABLE ZDETECTEDFACE (
    Z_PK, ZUUID, ZPERSON, ZASSET, ZAGETYPE, ZEYEMAKEUPTYPE, ZEYESSTATE,
    ZFACIALHAIRTYPE, ZGENDERTYPE, ZGLASSESTYPE, ZHAIRCOLORTYPE,
    ZHASSMILE, ZHIDDEN, ZISINTRASH, ZLIPMAKEUPTYPE, ZMANUAL,
    ZQUALITYMEASURE, ZSMILETYPE, ZSOURCEHEIGHT, ZSOURCEWIDTH, ZBLURSCORE,
    ZCENTERX, ZCENTERY, ZPOSEYAW, ZQUALITY, ZROLL, ZSIZE, ZMASTERIDENTIFIER
);

CREATE TABLE ZKEYWORD (Z_PK, ZTITLE);

CREATE TABLE Z_1KEYWORDS (Z_1ASSETATTRIBUTES, Z_37KEYWORDS);

CREATE TABLE Z_26ASSETS (Z_34ASSETS, Z_26ALBUMS, Z_FOK_34ASSETS);

CREATE TABLE ZFILESYSTEMVOLUME (Z_PK, ZUUID, ZNAME);

CREATE TABLE ZMOMENT (
    Z_PK, ZTIMEZONEOFFSET, ZTRASHEDSTATE, ZAPPROXIMATELATITUDE,
    ZAPPROXIMATELONGITUDE, ZENDDATE, ZMODIFICATIONDATE,
    ZREPRESENTATIVEDATE, ZSTARTDATE, ZSUBTITLE, ZTITLE, ZUUID
);

CREATE TABLE ZASSETDESCRIPTION (Z_PK, ZLONGDESCRIPTION);

CREATE TABLE ZUNMANAGEDADJUSTMENT (Z_PK, ZADJUSTMENTFORMATIDENTIFIER);

CREATE TABLE ZCLOUDMASTER (Z_PK, ZCLOUDLOCALSTATE, ZCLOUDMASTERGUID);

CREATE TABLE ZINTERNALRESOURCE (
    Z_PK, ZASSET, ZFINGERPRINT, ZLOCALAVAILABILITY, ZREMOTEAVAILABILITY,
    ZDATASTORESUBTYPE, ZRESOURCETYPE, ZUNIFORMTYPEIDENTIFIER, ZDATALENGTH,
    ZFILESYSTEMBOOKMARK, ZFILESYSTEMVOLUME
);

CREATE TABLE ZUNIFORMTYPEIDENTIFIER (Z_PK, ZIDENTIFIER);

CREATE TABLE ZFILESYSTEMBOOKMARK (Z_PK, ZRESOURCE, ZPATHRELATIVETOVOLUME);

CREATE TABLE ZEXTENDEDATTRIBUTES (ZASSET);

CREATE TABLE ZCOMPUTEDASSETATTRIBUTES (
    ZASSET, ZBEHAVIORALSCORE, ZFAILURESCORE, ZHARMONIOUSCOLORSCORE,
    ZIMMERSIVENESSSCORE, ZINTERACTIONSCORE, ZINTERESTINGSUBJECTSCORE,
    ZINTRUSIVEOBJECTPRESENCESCORE, ZLIVELYCOLORSCORE, ZLOWLIGHT,
    ZNOISESCORE, ZPLEASANTCAMERATILTSCORE, ZPLEASANTCOMPOSITIONSCORE,
    ZPLEASANTLIGHTINGSCORE, ZPLEASANTPATTERNSCORE,
    ZPLEASANTPERSPECTIVESCORE, ZPLEASANTPOSTPROCESSINGSCORE,
    ZPLEASANTREFLECTIONSSCORE, ZPLEASANTSYMMETRYSCORE,
    ZSHARPLYFOCUSEDSUBJECTSCORE, ZTASTEFULLYBLURREDSCORE,
    ZWELLCHOSENSUBJECTSCORE, ZWELLFRAMEDSUBJECTSCORE, ZWELLTIMEDSHOTSCORE
);

CREATE TABLE ZCLOUDSHAREDALBUMINVITATIONRECORD (
    ZINVITEEHASHEDPERSONID, ZINVITEEFIRSTNAME, ZINVITEELASTNAME,
    ZINVITEEFULLNAME
);

CREATE TABLE ZCLOUDSHAREDCOMMENT (
    ZCOMMENTEDASSET, ZLIKEDASSET, ZISLIKE, ZCOMMENTDATE, ZCOMMENTTEXT,
    ZCOMMENTERHASHEDPERSONID, ZISMYCOMMENT
);
"""
# Deliberately not created: ZSHAREPARTICIPANT, Z_PRIMARYKEY, ZSHARE, and any
# search-info tables. PhotosDB tolerates all of them being absent --
# `_get_collection_share_entity` catches sqlite3.Error on a missing
# Z_PRIMARYKEY, `_process_share_participant_names` checks `sqlite_columns`
# before querying ZSHAREPARTICIPANT, and `_process_searchinfo` is wrapped in
# a bare `try/except Exception` by PhotosDB itself.


_ASSET_UUID = "A1B2C3D4-0000-0000-0000-000000000001"
_ASSET_FILENAME = "IMG_0001.HEIC"

# osxphotos._constants._PHOTOS_5_ALBUM_KIND -- a normal (non-folder,
# non-root) album, as opposed to ZGENERICALBUM's _ROOT_FOLDER_KIND row above.
_ALBUM_KIND = 2
_ALBUM_UUID = "B1B2C3D4-0000-0000-0000-000000000001"
_PERSON_UUID = "C1B2C3D4-0000-0000-0000-000000000001"
_PERSON_NAME = "Jane Doe"
_FACE_UUID = "D1B2C3D4-0000-0000-0000-000000000001"

_SEARCH_INDEX_SCHEMA = """
CREATE TABLE ga (groupid, assetid);
CREATE TABLE groups (
    category, owning_groupid, content_string, normalized_string,
    lookup_identifier
);
CREATE TABLE assets (uuid_0, uuid_1);
"""


def _build_asset_image_bytes() -> bytes:
    """A tiny, real HEIC image -- decodable by the P1.7 media backend, not
    just a byte string PhotosDB's metadata walk never looks inside."""
    image = Image.new("RGB", (32, 24), color=(120, 160, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="HEIF", quality=50)
    return buffer.getvalue()


def _build_search_index(search_dir: pathlib.Path) -> None:
    search_dir.mkdir(parents=True)
    conn = sqlite3.connect(str(search_dir / "psi.sqlite"))
    try:
        conn.executescript(_SEARCH_INDEX_SCHEMA)
        conn.commit()
    finally:
        conn.close()


@dataclasses.dataclass(frozen=True)
class FixtureAsset:
    """One synthetic asset: the bytes written under `originals/` plus the
    metadata columns `PhotosDB` reads. `created` is Core Data seconds since
    2001-01-01 UTC, as Photos stores it."""

    uuid: str
    filename: str
    data: bytes
    uti: str = "public.heic"
    kind: int = 0  # ZKIND: 0 photo, 1 video
    created: float = 700000000.0
    width: int = 100
    height: int = 100
    favorite: bool = False
    hidden: bool = False


@dataclasses.dataclass(frozen=True)
class FixtureAlbum:
    uuid: str
    title: str
    asset_indexes: Sequence[int]  # 0-based positions in the assets list


@dataclasses.dataclass(frozen=True)
class FixturePerson:
    uuid: str
    name: str
    face_uuid: str
    asset_indexes: Sequence[int]


def _default_assets() -> list[FixtureAsset]:
    return [
        FixtureAsset(
            uuid=_ASSET_UUID, filename=_ASSET_FILENAME, data=_build_asset_image_bytes()
        )
    ]


def build_library(
    dest_dir: pathlib.Path,
    assets: Sequence[FixtureAsset],
    *,
    albums: Sequence[FixtureAlbum] = (),
    people: Sequence[FixturePerson] = (),
    package_name: str = "Synthetic.photoslibrary",
    wal_favorite_pk: int | None = None,
    store_uuid: str = "FIXTURE-STORE-UUID",
) -> pathlib.Path:
    """Create a `.photoslibrary`-shaped directory holding `assets` under
    `dest_dir` and return its path. Asset `i` gets `Z_PK` i+1. With
    `wal_favorite_pk`, that asset's favorite flag is flipped through an
    uncheckpointed WAL write (see `_write_uncheckpointed_wal_change`)."""
    package_path = dest_dir / package_name
    database_dir = package_path / "database"
    database_dir.mkdir(parents=True)

    sqlite_path = database_dir / "Photos.sqlite"
    conn = sqlite3.connect(str(sqlite_path))
    try:
        conn.executescript(_SCHEMA)
        plist_bytes = plistlib.dumps({"PLModelVersion": _MODEL_VERSION})
        conn.execute(
            "INSERT INTO Z_METADATA (Z_VERSION, Z_PLIST, Z_UUID) VALUES (?, ?, ?)",
            (1, plist_bytes, store_uuid),
        )
        conn.execute(
            """
            INSERT INTO ZGENERICALBUM (Z_PK, ZUUID, ZTITLE, ZKIND, ZPARENTFOLDER)
            VALUES (1, 'root-folder-uuid', NULL, ?, NULL)
            """,
            (_ROOT_FOLDER_KIND,),
        )
        for pk, asset in enumerate(assets, start=1):
            directory = asset.uuid[0]
            originals_dir = package_path / "originals" / directory
            originals_dir.mkdir(parents=True, exist_ok=True)
            (originals_dir / asset.filename).write_bytes(asset.data)
            conn.execute(
                """
                INSERT INTO ZGENERICASSET (
                    Z_PK, ZUUID, ZMODIFICATIONDATE, ZDATECREATED, ZHIDDEN,
                    ZFAVORITE, ZDIRECTORY, ZFILENAME, ZLATITUDE, ZLONGITUDE,
                    ZHASADJUSTMENTS, ZKIND, ZUNIFORMTYPEIDENTIFIER, ZKINDSUBTYPE,
                    ZTRASHEDSTATE, ZHEIGHT, ZWIDTH, ZORIENTATION, ZDEPTHSTATES,
                    ZVISIBILITYSTATE, ZSAVEDASSETTYPE, ZADDEDDATE
                )
                VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, NULL, NULL,
                    0, ?, ?, 0,
                    0, ?, ?, 1, 0,
                    0, 3, ?
                )
                """,
                (
                    pk,
                    asset.uuid,
                    asset.created,
                    asset.created,
                    int(asset.hidden),
                    int(asset.favorite),
                    directory,
                    asset.filename,
                    asset.kind,
                    asset.uti,
                    asset.height,
                    asset.width,
                    asset.created,
                ),
            )
            conn.execute(
                """
                INSERT INTO ZADDITIONALASSETATTRIBUTES (
                    Z_PK, ZASSET, ZORIGINALFILENAME, ZTIMEZONEOFFSET,
                    ZINFERREDTIMEZONEOFFSET, ZTIMEZONENAME, ZCAMERACAPTUREDEVICE,
                    ZORIGINALRESOURCECHOICE, ZORIGINALHEIGHT, ZORIGINALWIDTH,
                    ZORIGINALORIENTATION, ZORIGINALFILESIZE
                )
                VALUES (?, ?, ?, 0, 0, 'UTC', 0, 0, ?, ?, 1, ?)
                """,
                (pk, pk, asset.filename, asset.height, asset.width, len(asset.data)),
            )
        # Non-root albums (joined to assets via Z_26ASSETS, the same table
        # osxphotos's Photos-5 code path reads) and people (joined via
        # ZDETECTEDFACE) so the indexer's people/albums walk -- not just the
        # asset walk -- has non-empty rows to carry through `_write_index`
        # into `people`/`albums`/`asset_people`/`asset_albums`.
        for offset, album in enumerate(albums):
            album_pk = 2 + offset
            conn.execute(
                """
                INSERT INTO ZGENERICALBUM (Z_PK, ZUUID, ZTITLE, ZKIND, ZPARENTFOLDER, ZTRASHEDSTATE)
                VALUES (?, ?, ?, ?, 1, 0)
                """,
                (album_pk, album.uuid, album.title, _ALBUM_KIND),
            )
            for order, index in enumerate(album.asset_indexes, start=1):
                conn.execute(
                    "INSERT INTO Z_26ASSETS (Z_34ASSETS, Z_26ALBUMS, Z_FOK_34ASSETS) VALUES (?, ?, ?)",
                    (index + 1, album_pk, order),
                )
        face_pk = 0
        for person_pk, person in enumerate(people, start=1):
            conn.execute(
                """
                INSERT INTO ZPERSON (Z_PK, ZPERSONUUID, ZFULLNAME, ZFACECOUNT, ZDISPLAYNAME, ZTYPE)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (
                    person_pk,
                    person.uuid,
                    person.name,
                    len(person.asset_indexes),
                    person.name,
                ),
            )
            first_face_pk = face_pk + 1
            for index in person.asset_indexes:
                face_pk += 1
                face_uuid = (
                    person.face_uuid
                    if face_pk == first_face_pk
                    else f"{person.face_uuid[:-4]}{face_pk:04d}"
                )
                conn.execute(
                    """
                    INSERT INTO ZDETECTEDFACE (Z_PK, ZUUID, ZPERSON, ZASSET, ZHIDDEN, ZISINTRASH, ZMANUAL)
                    VALUES (?, ?, ?, ?, 0, 0, 0)
                    """,
                    (face_pk, face_uuid, person_pk, index + 1),
                )
            conn.execute(
                "UPDATE ZPERSON SET ZKEYFACE = ? WHERE Z_PK = ?",
                (first_face_pk, person_pk),
            )
        conn.commit()
    finally:
        conn.close()

    # A real library can have a non-empty `-wal`/`-shm` next to Photos.sqlite
    # whenever Photos.app or photoanalysisd holds the database open, with a
    # change committed to the WAL but not yet checkpointed into the main
    # file; the copy step in `open_library_readonly` has to pick up and
    # replay that too, not just copy the main file.
    if wal_favorite_pk is not None:
        _write_uncheckpointed_wal_change(sqlite_path, wal_favorite_pk)

    _build_search_index(database_dir / "search")

    return package_path


def build_fixture_library(dest_dir: pathlib.Path) -> pathlib.Path:
    """Create a `.photoslibrary`-shaped directory under `dest_dir` and return its path."""
    return build_library(
        dest_dir,
        _default_assets(),
        albums=[FixtureAlbum(_ALBUM_UUID, "Test Album", [0])],
        people=[FixturePerson(_PERSON_UUID, _PERSON_NAME, _FACE_UUID, [0])],
        wal_favorite_pk=1,
    )


def build_closed_fixture_library(dest_dir: pathlib.Path) -> pathlib.Path:
    """Like `build_fixture_library`, but shaped like a library Photos.app has
    actually closed: no `-wal`/`-shm` sidecars next to `Photos.sqlite`.

    `build_fixture_library` keeps its own connection open on the `-wal` file
    for the life of the test process (see `_WAL_ONLY_CONNECTIONS` below), so
    those sidecars always already exist there -- which hides a bug where
    opening the database recreates them, since nothing new gets created.
    Building a separate copy and checkpointing it is the only way to get a
    package with no sidecar files at all, which is what a real closed
    library on disk looks like.
    """
    open_path = build_fixture_library(dest_dir / "open")
    closed_path = dest_dir / "Synthetic.photoslibrary"
    shutil.copytree(open_path, closed_path)

    sqlite_path = closed_path / "database" / "Photos.sqlite"
    conn = sqlite3.connect(str(sqlite_path))
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    for suffix in ("-wal", "-shm"):
        sqlite_path.with_name(sqlite_path.name + suffix).unlink(missing_ok=True)

    return closed_path


# Connections kept alive here, never closed, for the life of the test
# process. Closing the last connection to a WAL database runs an automatic
# checkpoint that would merge the row below back into the main db file,
# which would leave the fixture's `-wal` empty and defeat the point of
# testing a real, unmerged WAL change.
_WAL_ONLY_CONNECTIONS: list[sqlite3.Connection] = []


def _write_uncheckpointed_wal_change(sqlite_path: pathlib.Path, asset_pk: int) -> None:
    """Flip the fixture asset's favorite flag via a WAL-mode write that is
    deliberately left uncheckpointed, so the main db file keeps the old
    value and only the `-wal` file holds the new one."""
    conn = sqlite3.connect(str(sqlite_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("UPDATE ZGENERICASSET SET ZFAVORITE = 1 WHERE Z_PK = ?", (asset_pk,))
    conn.commit()
    _WAL_ONLY_CONNECTIONS.append(conn)
