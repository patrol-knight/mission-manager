#!/usr/bin/env python3
"""Exports anomaly-detection history (backend/core/anomaly_repository.py)
to CSV, for a teammate to inspect or feed into model training.

Deliberately has no import from the backend package -- same reasoning as
tools/anomaly_simulator.py: a plain psycopg + DATABASE_URL script that runs
without the full backend installed or configured (no pydantic-settings
needed), portable to whoever's machine is doing the training.

Examples:
    # Everything, to stdout
    .venv/bin/python3 tools/anomaly_exporter.py

    # Just labeled training data, to a file
    .venv/bin/python3 tools/anomaly_exporter.py --resolution true_positive --output real.csv
    .venv/bin/python3 tools/anomaly_exporter.py --resolution false_positive --output false.csv

    # One test session's anomalies for debugging
    .venv/bin/python3 tools/anomaly_exporter.py --mission-id mission-2-tdpjxe --since 2026-07-27
"""

import argparse
import csv
import os
import sys

import psycopg

COLUMNS = [
    "anomaly_id", "frame_id", "x", "y", "lat", "lon", "type", "confidence",
    "source_device_id", "mission_id", "detected_at", "resolved_at", "resolution",
]


def build_query(args: argparse.Namespace) -> tuple[str, list]:
    clauses = []
    params: list = []

    if args.resolution == "unresolved":
        clauses.append("resolution IS NULL")
    elif args.resolution is not None:
        clauses.append("resolution = %s")
        params.append(args.resolution)

    if args.mission_id is not None:
        clauses.append("mission_id = %s")
        params.append(args.mission_id)

    if args.since is not None:
        clauses.append("detected_at >= %s")
        params.append(args.since)

    if args.until is not None:
        clauses.append("detected_at < %s")
        params.append(args.until)

    query = f"SELECT {', '.join(COLUMNS)} FROM anomalies"
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY detected_at"
    return query, params


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--database-url", default=os.environ.get("DATABASE_URL"),
        help="Postgres connection string. Defaults to the DATABASE_URL environment variable.",
    )
    parser.add_argument("--output", "-o", help="File to write CSV to. Defaults to stdout.")
    parser.add_argument(
        "--resolution", choices=["true_positive", "false_positive", "unresolved"], default=None,
        help="Filter by resolution. 'unresolved' means resolution IS NULL (still detected/investigating). "
        "Omit to include all rows regardless of resolution.",
    )
    parser.add_argument("--mission-id", default=None, help="Filter to anomalies detected during this mission.")
    parser.add_argument("--since", default=None, help="Only anomalies detected on/after this date (YYYY-MM-DD or full timestamp).")
    parser.add_argument("--until", default=None, help="Only anomalies detected before this date (YYYY-MM-DD or full timestamp).")
    args = parser.parse_args()

    if not args.database_url:
        parser.error("no database URL given -- pass --database-url or set the DATABASE_URL environment variable")

    query, params = build_query(args)

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    out = open(args.output, "w", newline="", encoding="utf-8") if args.output else sys.stdout
    try:
        writer = csv.writer(out)
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    finally:
        if args.output:
            out.close()

    print(f"[anomaly_exporter] wrote {len(rows)} row(s)" + (f" to {args.output}" if args.output else " to stdout"), file=sys.stderr)


if __name__ == "__main__":
    main()
