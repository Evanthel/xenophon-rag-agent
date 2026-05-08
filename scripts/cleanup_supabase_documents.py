#!/usr/bin/env python3

import argparse
import json

import requests


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete test or temporary documents from the Supabase RAG store."
    )
    parser.add_argument("--supabase-url", required=True)
    parser.add_argument("--anon-key", required=True)
    parser.add_argument("--ingest-token", required=True)
    parser.add_argument(
        "--source-path",
        action="append",
        default=[],
        help="Exact source_path to delete. Repeat for multiple documents.",
    )
    parser.add_argument(
        "--source-path-prefix",
        default="",
        help="Delete documents whose source_path starts with this prefix.",
    )
    parser.add_argument(
        "--title-prefix",
        default="",
        help="Delete documents whose title starts with this prefix.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show which documents would be removed without deleting them.",
    )
    args = parser.parse_args()

    if not args.source_path and not args.source_path_prefix and not args.title_prefix:
        raise SystemExit(
            "Provide at least one cleanup filter: --source-path, --source-path-prefix, or --title-prefix."
        )

    response = requests.post(
        f"{args.supabase_url.rstrip('/')}/functions/v1/cleanup-documents",
        headers={
            "Content-Type": "application/json",
            "apikey": args.anon_key,
            "Authorization": f"Bearer {args.anon_key}",
            "x-ingest-token": args.ingest_token,
        },
        json={
            "source_paths": args.source_path,
            "source_path_prefix": args.source_path_prefix,
            "title_prefix": args.title_prefix,
            "dry_run": args.dry_run,
        },
        timeout=120,
    )

    try:
        payload = response.json()
    except Exception:
        payload = {"raw": response.text}

    if not response.ok:
        raise SystemExit(f"Cleanup failed: HTTP {response.status_code} {payload}")

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
