import csv
import json
from typing import Any, Dict, List, Optional, Tuple

from app.constants import SHEETS_COLUMNS
from app.html_export import approved_rows_to_html, filter_approved, render_upc_faqaccordion
from app.scraping import build_outputs
from app.sheets import export_rows_to_google_sheets_oauth, read_rows_from_sheets_oauth


def read_sources_csv(path: str) -> List[Tuple[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)

        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except Exception:
            dialect = csv.excel
            dialect.delimiter = ","

        try:
            has_header = csv.Sniffer().has_header(sample)
        except Exception:
            has_header = False

        def parse_with_header() -> List[Tuple[str, str]]:
            reader = csv.DictReader(f, dialect=dialect)
            out_local: List[Tuple[str, str]] = []
            for r in reader:
                url = (r.get("URL") or r.get("url") or r.get("Url") or r.get("link") or "").strip()
                topic = (r.get("topic") or r.get("Topic") or r.get("tema") or r.get("Tema") or "").strip()
                if url:
                    out_local.append((url, topic))
            return out_local

        def parse_without_header() -> List[Tuple[str, str]]:
            reader = csv.reader(f, dialect=dialect)
            out_local: List[Tuple[str, str]] = []
            for row in reader:
                if not row:
                    continue
                first = (row[0] if len(row) > 0 else "").strip()
                if not first:
                    continue
                if first.lower() in ("url", "link"):
                    continue
                url = first
                topic = (row[1] if len(row) > 1 else "").strip()
                out_local.append((url, topic))
            return out_local

        if has_header:
            out = parse_with_header()
            if not out:
                f.seek(0)
                out = parse_without_header()
        else:
            out = parse_without_header()

        return out


def read_rows_from_csv_like_sheets(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except Exception:
            dialect = csv.excel
            dialect.delimiter = ";"

        reader = csv.DictReader(f, dialect=dialect)
        rows: List[Dict[str, str]] = []
        for r in reader:
            rows.append({(k or "").strip(): (v or "").strip() for k, v in r.items() if k})
        return rows


def export_like_sheets_csv(rows: List[List[str]], output_path: str):
    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(SHEETS_COLUMNS)
        w.writerows(rows)


def export_genweb_json(blocks: List[Dict[str, Any]], output_path: str):
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(blocks, f, ensure_ascii=False, indent=2)


def run_pipeline(
    input_mode: str,
    output_mode: str,
    sources_csv_path: Optional[str] = None,
    sources: Optional[List[Tuple[str, str]]] = None,
    output_file_path: Optional[str] = None,
    output_sheet_title: Optional[str] = None,
    output_sheet_tab: Optional[str] = None,
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    log=None,
    debug: bool = False,
    progress_cb=None,
):
    def _log(m: str):
        if log:
            log(m)

    if input_mode == "ui":
        if not sources:
            raise RuntimeError("No s'han afegit URLs a la UI.")
    elif input_mode == "csv":
        if not sources_csv_path:
            raise RuntimeError("Falta el fitxer CSV d'entrada.")
        sources = read_sources_csv(sources_csv_path)
    else:
        raise RuntimeError("input_mode ha de ser 'csv' o 'ui'.")

    _log(f"Sources loaded: {len(sources)}")
    if not sources:
        raise RuntimeError("No s'han trobat URLs. Afegeix almenys una URL.")

    rows, blocks, stats, errors = build_outputs(
        sources, log=log, debug=debug, progress_cb=progress_cb
    )

    if output_mode == "csv":
        if not output_file_path:
            raise RuntimeError("Falta el fitxer CSV de sortida.")
        export_like_sheets_csv(rows, output_file_path)
        _log(f"CSV written: {output_file_path}")
    elif output_mode == "genweb_json":
        if not output_file_path:
            raise RuntimeError("Falta el fitxer JSON de sortida.")
        export_genweb_json(blocks, output_file_path)
        _log(f"Genweb JSON written: {output_file_path}")
    elif output_mode == "sheets_oauth":
        if not (output_sheet_title and output_sheet_tab):
            raise RuntimeError("Falta el títol o la pestanya del Google Sheet de sortida.")
        export_rows_to_google_sheets_oauth(
            rows=rows,
            spreadsheet_title=output_sheet_title,
            worksheet_name=output_sheet_tab,
            oauth_client_json=oauth_client_json,
            token_file=token_file,
            log=log,
        )
        _log(f"Exported to Google Sheets: {output_sheet_title} / {output_sheet_tab}")
    else:
        raise RuntimeError("output_mode ha de ser 'csv', 'sheets_oauth' o 'genweb_json'.")

    stats["blocks"] = blocks
    stats["errors"] = errors
    return stats


def run_approved_to_html_pipeline(
    input_mode: str,
    input_csv_path: Optional[str] = None,
    sheet_title: Optional[str] = None,
    sheet_tab: Optional[str] = None,
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    output_path: str = "faqs_aprovades.txt",
    log=None,
) -> Dict[str, int]:
    def _log(m: str):
        if log:
            log(m)

    if input_mode == "csv":
        if not input_csv_path:
            raise RuntimeError("Falta el CSV d'entrada.")
        rows = read_rows_from_csv_like_sheets(input_csv_path)
    elif input_mode == "sheets_oauth":
        if not (sheet_title and sheet_tab):
            raise RuntimeError("Falta títol o pestanya del Google Sheet.")
        rows = read_rows_from_sheets_oauth(
            spreadsheet_title=sheet_title,
            worksheet_name=sheet_tab,
            oauth_client_json=oauth_client_json,
            token_file=token_file,
            log=log,
            create_if_missing=True,
        )
    else:
        raise RuntimeError("input_mode ha de ser 'csv' o 'sheets_oauth'.")

    _log(f"Files llegides: {len(rows)}")
    approved = filter_approved(rows)
    _log(f"Files aprovades: {len(approved)}")

    approved.sort(key=lambda r: ((r.get("Tema") or "").lower(), (r.get("Pregunta") or "").lower()))
    html_text = render_upc_faqaccordion(approved)

    topics = len({(r.get("Tema") or "").strip() for r in approved if (r.get("Tema") or "").strip()})
    _log(f"Fitxer generat: {output_path}")

    return {
        "total_rows": len(rows),
        "approved_rows": len(approved),
        "topics": topics,
        "html_text": html_text,
    }
