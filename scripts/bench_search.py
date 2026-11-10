"""D36 benchmark: the old Python scan vs the FTS5 index, on N synthetic assets.

Writes rows straight into a throwaway `app.db` (no photos, no osxphotos), so
250k assets take about a minute. Refuses to run unless the data dir is empty or
absent, and the caller deletes it afterwards.

    .venv/bin/python scripts/bench_search.py /tmp/bench-fts --assets 250000
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import random
import statistics
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from photos_viewer import app_db, library_assets, library_search, search_index

PLACES = [
    "Lisbon", "Zürich", "Paris", "Oslo", "Kyoto", "Reykjavík", "Porto", "Tromsø",
    "Vienna", "Lima", "Cusco", "Hanoi", "Cairo", "Nairobi", "Seattle", "Denver",
] * 20  # fmt: skip
FIRST = ["Ann", "Bob", "Chloé", "Dmitri", "Elena", "Farid", "Greta", "Hiro", "Ines"]
LABELS = [f"label{n}" for n in range(300)] + ["dog", "beach", "snow", "sports field"]
CAMERAS = [("Apple", "iPhone 12"), ("Apple", "iPhone 15 Pro"), ("Canon", "EOS R5")]

QUERIES = {
    "one term (place)": "lisbon",
    "one term (year)": "2023",
    "three terms": "lisbon iphone 2023",
    "no match": "zzzqqq",
}


def build(db, library_id: int, n: int) -> None:
    rng = random.Random(1)
    people = [(library_id, f"P{i}", f"{FIRST[i % 9]} Name{i}") for i in range(60)]
    db.executemany(
        "INSERT INTO people (library_id, uuid, name, display_name) VALUES (?, ?, ?, ?)",
        [(a, b, c, c) for a, b, c in people],
    )
    db.executemany(
        "INSERT INTO albums (library_id, uuid, title) VALUES (?, ?, ?)",
        [(library_id, f"A{i}", f"Album {rng.choice(PLACES)} {i}") for i in range(400)],
    )
    start = dt.datetime(2005, 1, 1)
    rows = []
    for i in range(n):
        when = start + dt.timedelta(seconds=rng.randrange(20 * 365 * 86400))
        place = rng.choice(PLACES) if rng.random() < 0.8 else None
        make, model = rng.choice(CAMERAS)
        rows.append(
            (
                library_id,
                f"U{i:08d}",
                f"IMG_{i:07d}.HEIC",
                f"IMG_{i:07d}.HEIC",
                when.isoformat() + "Z",
                when.strftime("%Y-%m-%d"),
                int(rng.random() < 0.01),
                place,
                f"{place} Road, Country" if place else None,
                make,
                model,
            )
        )
    db.executemany(
        "INSERT INTO assets (library_id, uuid, filename, original_filename, date_created, "
        "date_created_local_day, hidden, place, place_address, camera_make, camera_model) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    ids = [r[0] for r in db.execute("SELECT id FROM assets ORDER BY id")]
    db.executemany(
        "INSERT OR IGNORE INTO asset_people SELECT ?, id FROM people WHERE uuid = ?",
        [(i, f"P{rng.randrange(60)}") for i in ids if rng.random() < 0.15],
    )
    db.executemany(
        "INSERT OR IGNORE INTO asset_albums (asset_id, album_id) SELECT ?, id FROM albums WHERE uuid = ?",
        [(i, f"A{rng.randrange(400)}") for i in ids if rng.random() < 0.3],
    )
    labels = []
    for i in ids:
        for label in rng.sample(LABELS, 4):
            labels.append((i, label.title(), label))
    db.executemany(
        "INSERT OR IGNORE INTO asset_labels (asset_id, label, label_normalized) VALUES (?, ?, ?)",
        labels,
    )
    db.commit()


def timed(db, library_id: int, clause, runs: int) -> tuple[float, int]:
    times = []
    found = 0
    for _ in range(runs):
        t = time.perf_counter()
        page = library_assets._list_assets(
            db, library_id, hidden=False, cursor=None, limit=library_assets.DEFAULT_LIMIT,
            type_=None, from_=None, to=None, extra=clause,
        )  # fmt: skip
        times.append(time.perf_counter() - t)
        found = len(page.items)
    return statistics.median(times), found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", type=pathlib.Path)
    ap.add_argument("--assets", type=int, default=250_000)
    ap.add_argument("--runs", type=int, default=3)
    args = ap.parse_args()
    if args.data_dir.exists() and any(args.data_dir.iterdir()):
        sys.exit(f"{args.data_dir} is not empty")
    db = app_db.connect(args.data_dir)
    db.execute(
        "INSERT INTO libraries (display_name, path) VALUES ('bench', '/nowhere')"
    )
    library_id = db.execute("SELECT id FROM libraries").fetchone()[0]
    t = time.perf_counter()
    build(db, library_id, args.assets)
    print(f"generated {args.assets} assets in {time.perf_counter() - t:.1f}s")
    db_file = app_db.db_path(args.data_dir)

    def size() -> int:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return db_file.stat().st_size

    before = size()
    t = time.perf_counter()
    search_index.rebuild_library(db, library_id)
    db.commit()
    build_s = time.perf_counter() - t
    after = size()
    print(
        f"FTS build: {build_s:.1f}s ({build_s / args.assets * 1e6:.0f} us/asset), "
        f"app.db {before / 1e6:.0f} -> {after / 1e6:.0f} MB (+{(after - before) / 1e6:.0f} MB, "
        f"{(after - before) / args.assets:.0f} B/asset)"
    )
    library_search._register(db)
    print(f"{'query':20} {'scan ms':>10} {'fts ms':>10}  hits(first page)")
    for name, q in QUERIES.items():
        terms = library_search.parse_terms(q)
        scan, n1 = timed(
            db,
            library_id,
            library_search.scan_clause(terms),
            1 if args.assets > 50_000 else args.runs,
        )
        fts, n2 = timed(db, library_id, search_index.search_clause(terms), args.runs)
        print(f"{name:20} {scan * 1000:10.0f} {fts * 1000:10.1f}  {n1}/{n2}")
    db.close()


if __name__ == "__main__":
    main()
