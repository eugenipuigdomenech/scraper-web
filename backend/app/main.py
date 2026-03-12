from pathlib import Path
import sys
import csv
import io
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.constants import SHEETS_COLUMNS
from app.html_export import approved_rows_to_html
from app.job_manager import job_manager
from app.schemas import (
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
    SourceHtmlExportResponse,
    SheetsExportRequest,
    SheetsExportResponse,
)
from app.sheets import export_rows_to_google_sheets_oauth

BASE_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = BASE_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

PIPELINE_IMPORT_ERROR = None
run_pipeline = None
run_approved_to_html_pipeline = None
try:
    from scraper.pipeline import run_pipeline
    from scraper.pipeline import run_approved_to_html_pipeline
except Exception as exc:
    PIPELINE_IMPORT_ERROR = str(exc)

app = FastAPI(title="Scraper Web API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    # Dev-friendly CORS: qualsevol port local de Vite/React.
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "pipeline_imported": run_pipeline is not None,
        "pipeline_import_error": PIPELINE_IMPORT_ERROR,
    }


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

    return {
        "job_id": job["job_id"],
        "status": "done",
        "result": job["result"],
    }


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

    approved = sum(1 for it in items if it.get("approved"))
    return {
        "job_id": job_id,
        "total_items": len(items),
        "approved_items": approved,
        "pending_items": len(items) - approved,
        "items": items,
    }


@app.put("/api/jobs/{job_id}/review/{item_id}", response_model=ReviewItemResponse)
def update_job_review_item(job_id: str, item_id: str, payload: ReviewItemUpdateRequest):
    updated = job_manager.update_review_item(job_id=job_id, item_id=item_id, approved=payload.approved)
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

    # approved_rows_to_html espera: [topic, question, answer, source]
    approved_rows_compact = [
        [
            row[0] if len(row) > 0 else "",
            row[1] if len(row) > 1 else "",
            row[2] if len(row) > 2 else "",
            row[8] if len(row) > 8 else "",
        ]
        for row in rows
    ]

    html_text = approved_rows_to_html(approved_rows_compact)
    return {"job_id": job_id, "approved_rows": len(approved_rows_compact), "html_text": html_text}


@app.post("/api/export/html-from-source", response_model=SourceHtmlExportResponse)
async def export_html_from_source(
    input_mode: str = Form(...),
    csv_file: UploadFile | None = File(default=None),
    spreadsheet_title: str | None = Form(default=None),
    worksheet_name: str | None = Form(default=None),
    oauth_client_json: str = Form(default="oauth_client.json"),
    token_file: str = Form(default="token.json"),
):
    if run_approved_to_html_pipeline is None:
        raise HTTPException(status_code=500, detail=PIPELINE_IMPORT_ERROR or "Pipeline not available")

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

            result = run_approved_to_html_pipeline(
                input_mode="csv",
                input_csv_path=temp_path,
                oauth_client_json=oauth_client_json,
                token_file=token_file,
            )
        else:
            if not (spreadsheet_title or "").strip() or not (worksheet_name or "").strip():
                raise HTTPException(status_code=400, detail="Cal indicar el títol i la pestanya del Google Sheet.")

            result = run_approved_to_html_pipeline(
                input_mode="sheets_oauth",
                sheet_title=(spreadsheet_title or "").strip(),
                sheet_tab=(worksheet_name or "").strip(),
                oauth_client_json=oauth_client_json,
                token_file=token_file,
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)

    return {
        "input_mode": mode,
        "total_rows": result["total_rows"],
        "approved_rows": result["approved_rows"],
        "topics": result["topics"],
        "html_text": result["html_text"],
    }


@app.get("/api/jobs/{job_id}/export/csv")
def export_job_review_to_csv(job_id: str):
    rows = job_manager.get_review_rows(job_id=job_id, only_approved=False)
    if rows is None:
        raise HTTPException(status_code=404, detail="Job not found")

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(SHEETS_COLUMNS)
    writer.writerows(rows)
    output.seek(0)

    filename = f"job_{job_id}_review.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(output, media_type="text/csv; charset=utf-8", headers=headers)


@app.post("/api/jobs/{job_id}/export/sheets", response_model=SheetsExportResponse)
def export_job_review_to_sheets(job_id: str, payload: SheetsExportRequest):
    rows = job_manager.get_review_rows(job_id=job_id, only_approved=False)
    if rows is None:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        export_rows_to_google_sheets_oauth(
            rows=rows,
            spreadsheet_title=payload.spreadsheet_title,
            worksheet_name=payload.worksheet_name,
            oauth_client_json=payload.oauth_client_json,
            token_file=payload.token_file,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    approved_rows = sum(1 for row in rows if (row[3] or "").strip().lower() in {"aprovat", "aprovada", "approved"})
    return {
        "job_id": job_id,
        "approved_rows": approved_rows,
        "spreadsheet_title": payload.spreadsheet_title,
        "worksheet_name": payload.worksheet_name,
    }
