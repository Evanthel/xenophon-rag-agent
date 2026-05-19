#!/usr/bin/env python3

import argparse
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from typing import Iterable

import requests

try:
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit(
        "Missing dependency: pypdf. Install it with `python3 -m pip install pypdf requests`."
    ) from exc

try:
    import fitz
except ImportError:  # pragma: no cover - optional OCR fallback dependency
    fitz = None


REPEATED_WORD_RUN_RE = re.compile(r"\b([A-Za-z]{2,})\b(?:\s+\1\b){4,}", re.IGNORECASE)
INTERNAL_REPEAT_RE = re.compile(r"([A-Za-z]{2,4})\1{3,}", re.IGNORECASE)
PAGE_FOOTER_RE = re.compile(r"(?:[ivxlcdm]+|\d+|[A-Za-z])", re.IGNORECASE)
WORD_RE = re.compile(r"[A-Za-z]{2,}(?:[-'][A-Za-z]+)?")


def clean_text(text: str) -> str:
    raw_lines = [line.strip() for line in text.replace("\x00", " ").splitlines()]
    lines = [line for line in raw_lines if line]
    if len(lines) > 5 and PAGE_FOOTER_RE.fullmatch(lines[-1]):
        lines.pop()

    merged: list[str] = []
    for line in lines:
        if not merged:
            merged.append(line)
            continue

        previous = merged[-1]
        if previous.endswith("-") and line[:1].islower():
            merged[-1] = previous[:-1] + line
        elif previous[-1] not in ".!?;:" and line[:1].islower():
            merged[-1] = f"{previous} {line}"
        else:
            merged.append(line)

    return "\n".join(merged)


def looks_like_noisy_pdf_text(text: str) -> bool:
    normalized = clean_text(text)
    if not normalized:
        return False
    if REPEATED_WORD_RUN_RE.search(normalized):
        return True

    tokens = [token.lower() for token in WORD_RE.findall(normalized)]
    if len(tokens) < 20:
        return False

    adjacent_repeats = sum(1 for left, right in zip(tokens, tokens[1:]) if left == right)
    suspicious_tokens = sum(1 for token in tokens if INTERNAL_REPEAT_RE.search(token))
    return adjacent_repeats >= 4 or adjacent_repeats / len(tokens) >= 0.08 or suspicious_tokens >= 1


def extract_page_text_with_ocr(
    ocr_doc,
    page_index: int,
    ocr_lang: str,
    ocr_psm: str,
) -> str:
    page = ocr_doc.load_page(page_index)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    with tempfile.TemporaryDirectory() as tempdir:
        image_path = Path(tempdir) / f"page-{page_index + 1}.png"
        pixmap.save(image_path)
        result = subprocess.run(
            [
                "tesseract",
                str(image_path),
                "stdout",
                "--psm",
                ocr_psm,
                "-l",
                ocr_lang,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(f"Tesseract OCR failed on page {page_index + 1}: {stderr or 'unknown error'}")
    return clean_text(result.stdout)


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


def iter_pdf_chunks(
    path: Path,
    target_chars: int,
    overlap_chars: int,
    ocr_fallback: str,
    ocr_lang: str,
    ocr_psm: str,
) -> Iterable[dict]:
    reader = PdfReader(str(path))
    ocr_ready = ocr_fallback != "never" and fitz is not None and shutil.which("tesseract")
    ocr_doc = fitz.open(str(path)) if ocr_ready else None
    warned_missing_ocr = False
    ocr_pages_used: list[int] = []
    chunk_index = 0
    try:
        for page_idx, page in enumerate(reader.pages, start=1):
            raw_text = page.extract_text() or ""
            page_text = clean_text(raw_text)
            extraction_method = "pypdf"
            should_try_ocr = ocr_fallback == "always" or (
                ocr_fallback == "auto" and (not page_text or looks_like_noisy_pdf_text(raw_text))
            )

            if should_try_ocr:
                if ocr_doc is None:
                    if not warned_missing_ocr:
                        warned_missing_ocr = True
                        print(
                            f"{path.name}: OCR fallback requested but unavailable; "
                            "install PyMuPDF and tesseract or use --ocr-fallback never."
                        )
                else:
                    ocr_text = extract_page_text_with_ocr(
                        ocr_doc=ocr_doc,
                        page_index=page_idx - 1,
                        ocr_lang=ocr_lang,
                        ocr_psm=ocr_psm,
                    )
                    if ocr_text:
                        page_text = ocr_text
                        extraction_method = "ocr"
                        ocr_pages_used.append(page_idx)

            if not page_text:
                continue
            for piece in split_page_text(page_text, target_chars, overlap_chars):
                yield {
                    "chunk_index": chunk_index,
                    "content": piece,
                    "metadata": {
                        "page_start": page_idx,
                        "page_end": page_idx,
                        "extraction_method": extraction_method,
                    },
                }
                chunk_index += 1
        if ocr_pages_used:
            print(f"{path.name}: OCR fallback used on {len(ocr_pages_used)} page(s)")
    finally:
        if ocr_doc is not None:
            ocr_doc.close()


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
    ocr_fallback: str,
    ocr_lang: str,
    ocr_psm: str,
) -> None:
    chunks = list(iter_pdf_chunks(path, target_chars, overlap_chars, ocr_fallback, ocr_lang, ocr_psm))
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
    parser.add_argument("--ocr-fallback", choices=["auto", "always", "never"], default="auto")
    parser.add_argument("--ocr-lang", default="eng")
    parser.add_argument("--ocr-psm", default="6")
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
            ocr_fallback=args.ocr_fallback,
            ocr_lang=args.ocr_lang,
            ocr_psm=args.ocr_psm,
        )


if __name__ == "__main__":
    main()
