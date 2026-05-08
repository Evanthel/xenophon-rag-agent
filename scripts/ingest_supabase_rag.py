#!/usr/bin/env python3

import argparse
import math
from pathlib import Path
from typing import Iterable

import requests

try:
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit(
        "Missing dependency: pypdf. Install it with `python3 -m pip install pypdf requests`."
    ) from exc


def clean_text(text: str) -> str:
    lines = [line.strip() for line in text.replace("\x00", " ").splitlines()]
    return "\n".join(line for line in lines if line)


def split_page_text(text: str, target_chars: int, overlap_chars: int) -> list[str]:
    if len(text) <= target_chars:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + target_chars)
        if end < len(text):
            split_at = text.rfind("\n", start + math.floor(target_chars * 0.6), end)
            if split_at == -1:
                split_at = text.rfind(" ", start + math.floor(target_chars * 0.6), end)
            if split_at > start:
                end = split_at
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap_chars, start + 1)
    return chunks


def iter_pdf_chunks(path: Path, target_chars: int, overlap_chars: int) -> Iterable[dict]:
    reader = PdfReader(str(path))
    chunk_index = 0
    for page_idx, page in enumerate(reader.pages, start=1):
        page_text = clean_text(page.extract_text() or "")
        if not page_text:
            continue
        for piece in split_page_text(page_text, target_chars, overlap_chars):
            yield {
                "chunk_index": chunk_index,
                "content": piece,
                "metadata": {
                    "page_start": page_idx,
                    "page_end": page_idx,
                },
            }
            chunk_index += 1


def batched(items: list[dict], batch_size: int) -> Iterable[list[dict]]:
    for idx in range(0, len(items), batch_size):
        yield items[idx : idx + batch_size]


def upload_document(
    path: Path,
    supabase_url: str,
    anon_key: str,
    ingest_token: str,
    batch_size: int,
    target_chars: int,
    overlap_chars: int,
) -> None:
    chunks = list(iter_pdf_chunks(path, target_chars, overlap_chars))
    if not chunks:
        print(f"Skipping {path.name}: no extractable text")
        return

    print(
        f"{path.name}: extracted {len(chunks)} chunks "
        f"(target_chars={target_chars}, overlap_chars={overlap_chars}, batch_size={batch_size})"
    )

    endpoint = f"{supabase_url.rstrip('/')}/functions/v1/ingest-chunks"
    headers = {
        "Content-Type": "application/json",
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "x-ingest-token": ingest_token,
    }
    document = {
        "title": path.stem,
        "source_path": path.name,
        "source_type": "pdf",
        "metadata": {
            "source_file": path.name,
        },
    }

    for batch_number, batch in enumerate(batched(chunks, batch_size), start=1):
        response = requests.post(
            endpoint,
            headers=headers,
            json={
                "document": document,
                "replace": batch_number == 1,
                "chunks": batch,
            },
            timeout=120,
        )
        try:
            payload = response.json()
        except Exception:
            payload = {"raw": response.text}
        if not response.ok:
            raise RuntimeError(
                f"Failed to ingest {path.name} batch {batch_number}: {response.status_code} {payload}"
            )
        print(
            f"{path.name}: uploaded batch {batch_number} with {len(batch)} chunks "
            f"(total chunks: {len(chunks)})"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract PDFs and upload chunk batches to Supabase RAG.")
    parser.add_argument("paths", nargs="+", help="PDF files to ingest")
    parser.add_argument("--supabase-url", required=True)
    parser.add_argument("--anon-key", required=True)
    parser.add_argument("--ingest-token", required=True)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--target-chars", type=int, default=1600)
    parser.add_argument("--overlap-chars", type=int, default=200)
    args = parser.parse_args()

    for raw_path in args.paths:
        path = Path(raw_path)
        if not path.exists():
            raise SystemExit(f"File not found: {path}")
        upload_document(
            path=path,
            supabase_url=args.supabase_url,
            anon_key=args.anon_key,
            ingest_token=args.ingest_token,
            batch_size=args.batch_size,
            target_chars=args.target_chars,
            overlap_chars=args.overlap_chars,
        )


if __name__ == "__main__":
    main()
