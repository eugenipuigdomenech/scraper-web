from __future__ import annotations

import csv
import io
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path
import unicodedata

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from starlette.middleware.sessions import SessionMiddleware

from app.constants import SHEETS_COLUMNS
from app.html_export import (
    approved_rows_to_html,
    filter_approved,
    render_upc_faqaccordion,
)
from app.job_manager import job_manager
from app.schemas import (
    GoogleConnectResponse,
    GoogleDriveListResponse,
    GoogleSessionResponse,
    GoogleSheetsListResponse,
    GoogleWorksheetListResponse,
    HtmlExportResponse,
    JobCreatedResponse,
    JobDetailResponse,
    JobResultResponse,
    JobSummaryResponse,
    ReviewAllUpdateRequest,
    ReviewBulkUpdateRequest,
    ReviewItemResponse,
    ReviewItemUpdateRequest,
    ReviewListResponse,
    ReviewUpdateResponse,
    ScrapeJobRequest,
    SheetsExportRequest,
    SheetsExportResponse,
    SourceHtmlExportResponse,
)
from app.sheets import (
    create_google_authorization_url,
    ensure_fixed_faqs_spreadsheet_oauth,
    exchange_google_authorization_code,
    export_rows_to_google_sheets_oauth,
    get_google_session_status,
    list_drive_items_oauth,
    list_spreadsheets_oauth,
    list_worksheets_oauth,
    logout_google_session,
    read_rows_from_sheets_oauth,
)


def _normalize_text(value: str) -> str:
    txt = (value or "").strip().lower()
    if not txt:
        return ""
    txt = unicodedata.normalize("NFKD", txt)
    txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
    return txt


def _row_value(row: dict[str, str], *names: str) -> str:
    aliases = {_normalize_text(name) for name in names}
    for key, value in row.items():
        if _normalize_text(key) in aliases:
            return (value or "").strip()
    return ""


def normalize_row_dict(row: dict[str, str]) -> dict[str, str]:
    return {
        "Tema": _row_value(row, "Tema", "topic", "Topic"),
        "Subtopic": _row_value(row, "Subtopic", "Sub topic", "Subtema", "Sub tema", "Subtòpic", "Sub tòpic"),
        "Pregunta": _row_value(row, "Pregunta", "question", "Question"),
        "Resposta": _row_value(row, "Resposta", "answer", "Answer"),
        "Estat": _row_value(row, "Estat", "estat", "status", "Status"),
        "Font": _row_value(row, "Font", "source", "URL"),
    }


def apply_default_subtopics(rows: list[dict[str, str]], default_value: str = "-") -> list[dict[str, str]]:
    normalized_rows: list[dict[str, str]] = []
    for row in rows:
        normalized = dict(row)
        if not (normalized.get("Subtopic") or "").strip():
            normalized["Subtopic"] = default_value
        normalized_rows.append(normalized)
    return normalized_rows


def validate_subtopics(rows: list[dict[str, str]], require_for_approved: bool = True) -> None:
    for index, row in enumerate(rows, start=1):
        topic = (row.get("Tema") or "").strip()
        question = (row.get("Pregunta") or "").strip()
        answer = (row.get("Resposta") or "").strip()
        if not topic or not question or not answer:
            raise ValueError(f"La fila aprovada {index} té camps obligatoris buits.")


def render_genweb_accordion(rows: list[dict[str, str]]) -> tuple[str, int]:
    html_text = render_upc_faqaccordion(rows)
    groups = {
        ((row.get("Subtopic") or "").strip() if (row.get("Subtopic") or "").strip() not in {"-", "--", "–", "—"} else "")
        or (row.get("Tema") or "").strip()
        or "Preguntes frequents"
        for row in rows
    }
    groups.discard("")
    return html_text, len(groups) or 1

app = FastAPI(title="Scraper Web API")

default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
configured_cors_origins = [
    item.strip()
    for item in (os.getenv("BACKEND_CORS_ORIGINS") or "").split(",")
    if item.strip()
]

app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("APP_SESSION_SECRET", "dev-session-secret-change-me"),
    same_site="lax",
    https_only=(os.getenv("SESSION_COOKIE_SECURE") or "").strip().lower() in {"1", "true", "yes"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_cors_origins or default_cors_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GOOGLE_OAUTH_CALLBACK_PATH = "/api/google/callback"
GOOGLE_OAUTH_STATE_TTL_SECONDS = 900
pending_google_oauth_states: dict[str, dict[str, str | float]] = {}
pending_google_oauth_lock = threading.Lock()
GOOGLE_SESSION_HEADER = "x-google-session-id"


def _frontend_base_url(request: Request) -> str:
    explicit = (os.getenv("FRONTEND_PUBLIC_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin:
        return origin

    return str(request.base_url).rstrip("/")


def _google_callback_url(request: Request) -> str:
    explicit = (os.getenv("GOOGLE_OAUTH_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit
    return str(request.url_for("google_callback"))


def _ensure_browser_session(request: Request) -> str:
    header_session_id = (request.headers.get(GOOGLE_SESSION_HEADER) or "").strip()
    if header_session_id:
        request.session["google_session_id"] = header_session_id
        return header_session_id

    session_id = request.session.get("google_session_id")
    if not session_id:
        session_id = secrets.token_urlsafe(24)
        request.session["google_session_id"] = session_id
    return session_id


def _session_token_file(request: Request) -> str:
    session_id = _ensure_browser_session(request)
    return f"google_tokens/{session_id}.json"


def _store_pending_google_oauth_state(state: str, session_id: str, oauth_client_json: str, code_verifier: str) -> None:
    now = time.time()
    with pending_google_oauth_lock:
        expired = [
            key
            for key, payload in pending_google_oauth_states.items()
            if now - float(payload.get("created_at", 0)) > GOOGLE_OAUTH_STATE_TTL_SECONDS
        ]
        for key in expired:
            pending_google_oauth_states.pop(key, None)

        pending_google_oauth_states[state] = {
            "session_id": session_id,
            "oauth_client_json": oauth_client_json,
            "code_verifier": code_verifier,
            "created_at": now,
        }


def _consume_pending_google_oauth_state(state: str | None) -> dict[str, str | float] | None:
    if not state:
        return None
    with pending_google_oauth_lock:
        payload = pending_google_oauth_states.pop(state, None)
    if not payload:
        return None
    if time.time() - float(payload.get("created_at", 0)) > GOOGLE_OAUTH_STATE_TTL_SECONDS:
        return None
    return payload


def _google_popup_response(status: str, message: str = "") -> HTMLResponse:
    safe_status = "success" if status == "success" else "error"
    safe_message = (message or "").replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
    html = f"""<!doctype html>
<html lang="ca">
<head>
  <meta charset="utf-8" />
  <title>Google OAuth</title>
</head>
<body>
  <script>
    (function () {{
      var payload = {{ source: 'google-oauth', status: '{safe_status}', message: '{safe_message}' }};
      try {{
        if (window.opener && !window.opener.closed) {{
          window.opener.postMessage(payload, '*');
          window.close();
          return;
        }}
      }} catch (error) {{}}
      var nextUrl = '/?google_auth=' + encodeURIComponent(payload.status);
      if (payload.message) {{
        nextUrl += '&message=' + encodeURIComponent(payload.message);
      }}
      window.location.replace(nextUrl);
    }})();
  </script>
  <p>Autenticacio completada. Pots tancar aquesta pestanya.</p>
</body>
</html>"""
    return HTMLResponse(content=html)


def _read_csv_rows(path: str) -> list[dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except Exception:
            dialect = csv.excel
            dialect.delimiter = ";"

        reader = csv.DictReader(handle, dialect=dialect)
        if not reader.fieldnames:
            raise ValueError("El CSV no té capçalera.")

        normalized_headers = {header.strip() for header in reader.fieldnames if header}
        required = {"Tema", "Subtopic", "Pregunta", "Resposta", "Estat", "Font"}
        missing = sorted(required - normalized_headers)
        if missing:
            raise ValueError(f"Falten columnes al CSV: {', '.join(missing)}.")

        return [normalize_row_dict(row) for row in reader]


def _build_export_from_rows(rows: list[dict[str, str]], input_mode: str) -> dict[str, str | int]:
    approved = filter_approved(rows)
    approved = apply_default_subtopics(approved)
    validate_subtopics(approved, require_for_approved=False)
    html_text, groups = render_genweb_accordion(approved)
    return {
        "input_mode": input_mode,
        "total_rows": len(rows),
        "approved_rows": len(approved),
        "groups": groups,
        "html_text": html_text,
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/google/session", response_model=GoogleSessionResponse)
def google_session(request: Request, oauth_client_json: str = "oauth_client.json"):
    token_file = _session_token_file(request)
    return get_google_session_status(token_file=token_file, oauth_client_json=oauth_client_json)


@app.post("/api/google/connect", response_model=GoogleConnectResponse)
def google_connect(request: Request, oauth_client_json: str = Form(default="oauth_client.json")):
    session_id = _ensure_browser_session(request)
    callback_url = _google_callback_url(request)
    state = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(72)
    _store_pending_google_oauth_state(state, session_id, oauth_client_json, code_verifier)

    try:
        authorization_url = create_google_authorization_url(
            oauth_client_json=oauth_client_json,
            redirect_uri=callback_url,
            state=state,
            code_verifier=code_verifier,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"authorization_url": authorization_url}


@app.get(GOOGLE_OAUTH_CALLBACK_PATH, name="google_callback")
def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return _google_popup_response("error", error)

    pending_state = _consume_pending_google_oauth_state(state)
    if not code or not pending_state:
        return _google_popup_response("error", "oauth_state_invalid")

    oauth_client_json = str(pending_state.get("oauth_client_json") or "oauth_client.json")
    code_verifier = str(pending_state.get("code_verifier") or "").strip()
    session_id = str(pending_state.get("session_id") or "").strip()
    if not session_id or not code_verifier:
        return _google_popup_response("error", "oauth_state_invalid")

    request.session["google_session_id"] = session_id
    token_file = f"google_tokens/{session_id}.json"
    callback_url = _google_callback_url(request)

    try:
        exchange_google_authorization_code(
            oauth_client_json=oauth_client_json,
            code=code,
            state=state,
            redirect_uri=callback_url,
            code_verifier=code_verifier,
            token_file=token_file,
        )
    except Exception as exc:
        return _google_popup_response("error", str(exc))

    return _google_popup_response("success")


@app.post("/api/google/logout", response_model=GoogleSessionResponse)
def google_logout(request: Request):
    token_file = _session_token_file(request)
    return logout_google_session(token_file=token_file)


@app.get("/api/google/spreadsheets", response_model=GoogleSheetsListResponse)
def google_spreadsheets(request: Request, oauth_client_json: str = "oauth_client.json"):
    token_file = _session_token_file(request)
    try:
        spreadsheets = list_spreadsheets_oauth(oauth_client_json=oauth_client_json, token_file=token_file)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"spreadsheets": spreadsheets}


@app.get("/api/google/drive/items", response_model=GoogleDriveListResponse)
def google_drive_items(request: Request, parent_id: str | None = None):
    token_file = _session_token_file(request)
    try:
        items = list_drive_items_oauth(token_file=token_file, parent_id=parent_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"parent_id": parent_id, "items": items}


@app.get("/api/google/spreadsheets/worksheets", response_model=GoogleWorksheetListResponse)
def google_spreadsheet_worksheets(request: Request, spreadsheet_id: str):
    token_file = _session_token_file(request)
    try:
        worksheets = list_worksheets_oauth(token_file=token_file, spreadsheet_id=spreadsheet_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"spreadsheet_id": spreadsheet_id, "worksheets": worksheets}


@app.post("/api/jobs/scrape", response_model=JobCreatedResponse)
def create_scrape_job(payload: ScrapeJobRequest):
    sources = [(item.url, item.topic) for item in payload.sources]
    try:
        job = job_manager.create_scrape_job(sources=sources, debug=payload.debug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job_id": job["job_id"], "status": job["status"]}


@app.get("/api/jobs", response_model=list[JobSummaryResponse])
def list_jobs():
    jobs = job_manager.list_jobs()
    return [
        {
            "job_id": j["job_id"],
            "status": j["status"],
            "created_at": j["created_at"],
            "updated_at": j["updated_at"],
            "total_sources": j["total_sources"],
            "processed_sources": j["processed_sources"],
            "progress_ratio": j["progress_ratio"],
            "current_url": j["current_url"],
            "error": j["error"],
        }
        for j in jobs
    ]


@app.get("/api/jobs/{job_id}", response_model=JobDetailResponse)
def get_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "total_sources": job["total_sources"],
        "processed_sources": job["processed_sources"],
        "progress_ratio": job["progress_ratio"],
        "current_url": job["current_url"],
        "error": job["error"],
        "logs": job["logs"],
    }


@app.get("/api/jobs/{job_id}/result", response_model=JobResultResponse)
def get_job_result(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail="Job not finished")

    return {"job_id": job["job_id"], "status": "done", "result": job["result"]}


@app.get("/api/jobs/{job_id}/review", response_model=ReviewListResponse)
def get_job_review_items(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail="Job not finished")

    items = job_manager.get_review_items(job_id)
    if items is None:
        raise HTTPException(status_code=404, detail="Job not found")

    approved = sum(1 for item in items if item.get("approved"))
    return {
        "job_id": job_id,
        "total_items": len(items),
        "approved_items": approved,
        "pending_items": len(items) - approved,
        "items": items,
    }


@app.put("/api/jobs/{job_id}/review/{item_id}", response_model=ReviewItemResponse)
def update_job_review_item(job_id: str, item_id: str, payload: ReviewItemUpdateRequest):
    updated = job_manager.update_review_item(job_id=job_id, item_id=item_id, changes=payload.model_dump(exclude_unset=True))
    if updated is None:
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(status_code=404, detail="Review item not found")
    return updated


@app.put("/api/jobs/{job_id}/review", response_model=ReviewUpdateResponse)
def bulk_update_job_review_items(job_id: str, payload: ReviewBulkUpdateRequest):
    updated = job_manager.bulk_set_review_items(job_id=job_id, item_ids=payload.item_ids, approved=payload.approved)
    if updated is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "updated_count": updated}


@app.put("/api/jobs/{job_id}/review/all", response_model=ReviewUpdateResponse)
def update_all_job_review_items(job_id: str, payload: ReviewAllUpdateRequest):
    updated = job_manager.set_all_review_items(job_id=job_id, approved=payload.approved)
    if updated is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "updated_count": updated}


@app.post("/api/jobs/{job_id}/export/html", response_model=HtmlExportResponse)
def export_job_review_to_html(job_id: str):
    rows = job_manager.get_review_rows(job_id=job_id, only_approved=True)
    if rows is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        export_result = approved_rows_to_html(rows)
        if isinstance(export_result, tuple):
            html_text, groups = export_result
        else:
            html_text = export_result
            group_rows = [
                {
                    "Tema": row[0] if len(row) > 0 else "",
                    "Subtopic": row[1] if len(row) > 1 else "",
                    "Pregunta": row[2] if len(row) > 2 else "",
                    "Resposta": row[3] if len(row) > 3 else "",
                    "Font": row[4] if len(row) > 4 else "",
                }
                for row in rows
            ]
            _, groups = render_genweb_accordion(group_rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job_id": job_id, "approved_rows": len(rows), "html_text": html_text, "groups": groups}


@app.post("/api/export/html-from-source", response_model=SourceHtmlExportResponse)
async def export_html_from_source(
    request: Request,
    input_mode: str = Form(...),
    csv_file: UploadFile | None = File(default=None),
    spreadsheet_title: str | None = Form(default=None),
    worksheet_name: str | None = Form(default=None),
    oauth_client_json: str = Form(default="oauth_client.json"),
):
    mode = (input_mode or "").strip()
    if mode not in {"csv", "sheets_oauth"}:
        raise HTTPException(status_code=400, detail="input_mode ha de ser 'csv' o 'sheets_oauth'.")

    temp_path = None
    try:
        if mode == "csv":
            if csv_file is None:
                raise HTTPException(status_code=400, detail="Falta adjuntar el fitxer CSV.")
            suffix = Path(csv_file.filename or "input.csv").suffix or ".csv"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = temp_file.name
                temp_file.write(await csv_file.read())
            rows = _read_csv_rows(temp_path)
        else:
            if not (spreadsheet_title or "").strip() or not (worksheet_name or "").strip():
                raise HTTPException(status_code=400, detail="Cal indicar el títol i la pestanya del Google Sheet.")
            fixed_sheet = ensure_fixed_faqs_spreadsheet_oauth(
                oauth_client_json=oauth_client_json,
                token_file=_session_token_file(request),
            )
            sheet_rows = read_rows_from_sheets_oauth(
                spreadsheet_title=fixed_sheet["spreadsheet_title"],
                worksheet_name=fixed_sheet["worksheet_name"],
                spreadsheet_id=fixed_sheet["spreadsheet_id"],
                oauth_client_json=oauth_client_json,
                token_file=_session_token_file(request),
                create_if_missing=True,
            )
            rows = [normalize_row_dict(row) for row in sheet_rows]

        payload = _build_export_from_rows(rows, mode)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)

    return payload


@app.get("/api/jobs/{job_id}/export/csv")
def export_job_review_to_csv(job_id: str, filename: str | None = None):
    rows = job_manager.get_review_rows(job_id=job_id, only_approved=False)
    if rows is None:
        raise HTTPException(status_code=404, detail="Job not found")

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(SHEETS_COLUMNS)
    writer.writerows(rows)
    output.seek(0)

    safe_name = (filename or f"job_{job_id}_review.csv").strip()
    if not safe_name.lower().endswith(".csv"):
        safe_name = f"{safe_name}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{safe_name}"'}
    return StreamingResponse(output, media_type="text/csv; charset=utf-8", headers=headers)


@app.post("/api/jobs/{job_id}/export/sheets", response_model=SheetsExportResponse)
def export_job_review_to_sheets(request: Request, job_id: str, payload: SheetsExportRequest):
    rows = job_manager.get_review_rows(job_id=job_id, only_approved=False)
    if rows is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        fixed_sheet = ensure_fixed_faqs_spreadsheet_oauth(
            oauth_client_json=payload.oauth_client_json,
            token_file=_session_token_file(request),
        )
        export_rows_to_google_sheets_oauth(
            rows=rows,
            spreadsheet_title=fixed_sheet["spreadsheet_title"],
            spreadsheet_id=fixed_sheet["spreadsheet_id"],
            worksheet_name=fixed_sheet["worksheet_name"],
            oauth_client_json=payload.oauth_client_json,
            token_file=_session_token_file(request),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    approved_rows = sum(1 for row in rows if (row[4] or "").strip().lower() in {"aprovat", "aprovada", "approved"})
    return {
        "job_id": job_id,
        "approved_rows": approved_rows,
        "spreadsheet_title": fixed_sheet["spreadsheet_title"],
        "worksheet_name": fixed_sheet["worksheet_name"],
    }
