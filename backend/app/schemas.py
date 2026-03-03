from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SourceIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    topic: str = ""


class ScrapeJobRequest(BaseModel):
    sources: list[SourceIn] = Field(min_length=1)
    debug: bool = False


class JobCreatedResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "error"]


class JobSummaryResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "error"]
    created_at: str
    updated_at: str
    total_sources: int
    processed_sources: int
    progress_ratio: float
    current_url: str | None
    error: str | None


class JobDetailResponse(JobSummaryResponse):
    logs: list[str]


class JobResultResponse(BaseModel):
    job_id: str
    status: Literal["done"]
    result: dict


class ReviewItemResponse(BaseModel):
    id: str
    topic: str
    question: str
    answer: str
    source: str
    status: Literal["Pendent", "Aprovat"]
    approved: bool


class ReviewListResponse(BaseModel):
    job_id: str
    total_items: int
    approved_items: int
    pending_items: int
    items: list[ReviewItemResponse]


class ReviewItemUpdateRequest(BaseModel):
    approved: bool


class ReviewBulkUpdateRequest(BaseModel):
    item_ids: list[str] = Field(min_length=1)
    approved: bool


class ReviewAllUpdateRequest(BaseModel):
    approved: bool


class ReviewUpdateResponse(BaseModel):
    job_id: str
    updated_count: int


class HtmlExportResponse(BaseModel):
    job_id: str
    approved_rows: int
    html_text: str


class SheetsExportRequest(BaseModel):
    spreadsheet_title: str = Field(min_length=1)
    worksheet_name: str = Field(min_length=1)
    oauth_client_json: str = "oauth_client.json"
    token_file: str = "token.json"


class SheetsExportResponse(BaseModel):
    job_id: str
    approved_rows: int
    spreadsheet_title: str
    worksheet_name: str
