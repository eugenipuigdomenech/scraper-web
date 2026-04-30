from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SourceIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    topic: str = Field(default="", max_length=200)


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
    subtopic: str
    question: str
    answer: str
    source: str
    status: Literal["Pendent", "Aprovat"]
    approved: bool
    created_at: str
    updated_at: str
    last_modified_by: str
    annual_update: str


class ReviewListResponse(BaseModel):
    job_id: str
    total_items: int
    approved_items: int
    pending_items: int
    items: list[ReviewItemResponse]


class ReviewItemUpdateRequest(BaseModel):
    approved: bool | None = None
    topic: str | None = Field(default=None, max_length=200)
    subtopic: str | None = Field(default=None, max_length=200)
    question: str | None = None
    answer: str | None = None
    source: str | None = Field(default=None, max_length=2048)
    annual_update: str | None = Field(default=None, max_length=200)
    last_modified_by: str | None = Field(default=None, max_length=200)


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
    groups: int


class SourceHtmlExportResponse(BaseModel):
    input_mode: Literal["csv", "sheets_oauth"]
    total_rows: int
    approved_rows: int
    groups: int
    html_text: str


class GenwebPublishRequest(BaseModel):
    target_url: str = Field(min_length=1, max_length=2048)
    html_text: str = Field(min_length=1)
    username: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=512)


class GenwebPublishResponse(BaseModel):
    status: Literal["published"]
    api_url: str


class SheetsExportRequest(BaseModel):
    spreadsheet_title: str = Field(min_length=1)
    spreadsheet_id: str | None = None
    worksheet_name: str = Field(min_length=1)
    oauth_client_json: str = "oauth_client.json"
    token_file: str = "token.json"


class SheetsExportResponse(BaseModel):
    job_id: str
    approved_rows: int
    spreadsheet_id: str
    spreadsheet_title: str
    worksheet_name: str


class GoogleSessionResponse(BaseModel):
    connected: bool
    token_file: str
    account_hint: str | None = None
    oauth_client_json: str | None = None
    oauth_client_found: bool | None = None
    profile_name: str | None = None
    profile_email: str | None = None
    profile_picture: str | None = None


class GoogleConnectResponse(BaseModel):
    authorization_url: str


class GoogleSheetsListResponse(BaseModel):
    spreadsheets: list[str]


class GoogleDriveItemResponse(BaseModel):
    id: str
    name: str
    mime_type: str
    kind: Literal["folder", "spreadsheet", "file"]


class GoogleDriveListResponse(BaseModel):
    parent_id: str | None = None
    items: list[GoogleDriveItemResponse]


class GoogleWorksheetListResponse(BaseModel):
    spreadsheet_id: str
    worksheets: list[str]


class FaqSheetStatsResponse(BaseModel):
    spreadsheet_id: str
    worksheet_name: str
    total_faqs: int
    approved_faqs: int


class GoogleFixedFaqsListResponse(BaseModel):
    folder_path: str
    items: list[GoogleDriveItemResponse]


class GoogleDriveFileContentResponse(BaseModel):
    file_id: str
    name: str
    content: str


class SaveConfigRequest(BaseModel):
    name: str = Field(min_length=1)
    content: str = Field(min_length=1)


class SaveConfigResponse(BaseModel):
    file_id: str
    name: str
    status: Literal["saved"]


class ShareDriveFileRequest(BaseModel):
    file_id: str = Field(min_length=1)
    email: str = Field(min_length=3)
    role: Literal["reader", "writer", "commenter"] = "writer"


class ShareDriveFileResponse(BaseModel):
    file_id: str
    email: str
    role: Literal["reader", "writer", "commenter"]
    status: Literal["shared"]


class DriveShareCountResponse(BaseModel):
    file_id: str
    shared_people_count: int
    shared_people: list[str]
