from __future__ import annotations

import json
import os
from datetime import datetime
from functools import lru_cache

import gspread
from google.oauth2.service_account import Credentials as ServiceAccountCredentials

ACTIVITY_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _resolve_service_account_info() -> dict:
    raw_json = (os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    if raw_json:
        return json.loads(raw_json)

    service_account_file = (os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE") or "").strip()
    if not service_account_file:
        raise RuntimeError("Falta configurar GOOGLE_SERVICE_ACCOUNT_FILE o GOOGLE_SERVICE_ACCOUNT_JSON.")

    raw_path = service_account_file.replace("\\", "/")
    candidates = []
    if os.path.isabs(raw_path):
        candidates.append(raw_path)
    else:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        candidates.append(os.path.join(project_root, raw_path))
        candidates.append(os.path.abspath(raw_path))

    existing_path = next((path for path in candidates if os.path.exists(path)), None)
    if not existing_path:
        raise RuntimeError(
            f"No s'ha trobat GOOGLE_SERVICE_ACCOUNT_FILE: {service_account_file}. "
            f"Rutes provades: {', '.join(candidates)}"
        )

    with open(existing_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def _get_gspread_client() -> gspread.Client:
    info = _resolve_service_account_info()
    creds = ServiceAccountCredentials.from_service_account_info(info, scopes=ACTIVITY_SCOPES)
    return gspread.authorize(creds)


def _get_activity_worksheet() -> gspread.Worksheet:
    spreadsheet_id = (os.getenv("ACTIVITY_LOG_SPREADSHEET_ID") or "").strip()
    worksheet_name = (os.getenv("ACTIVITY_LOG_WORKSHEET_NAME") or "Sheet1").strip() or "Sheet1"
    if not spreadsheet_id:
        raise RuntimeError("Falta configurar ACTIVITY_LOG_SPREADSHEET_ID.")

    client = _get_gspread_client()
    spreadsheet = client.open_by_key(spreadsheet_id)
    return spreadsheet.worksheet(worksheet_name)


def append_activity_log_row(row_values: list[str | int | None]) -> None:
    worksheet = _get_activity_worksheet()
    # Format requested by the user: dd/MM/yyyy HH:mm:ss
    formatted_timestamp = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    worksheet.append_row(
        [
            formatted_timestamp,
            *row_values,
        ],
        value_input_option="RAW",
    )
