import os
import re
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from bs4 import BeautifulSoup, NavigableString

import gspread
import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials as OAuthCredentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from google_auth_oauthlib.flow import Flow

try:
    from .constants import OAUTH_SCOPES, SHEETS_COLUMNS
except ImportError:
    from constants import OAUTH_SCOPES, SHEETS_COLUMNS


FIXED_DRIVE_ROOT_FOLDER = "UPC"
FIXED_DRIVE_FAQS_FOLDER = "FAQs"
FIXED_DRIVE_CONFIGS_FOLDER = "Configuracions"
FIXED_SPREADSHEET_TITLE = "FAQs"
FIXED_WORKSHEET_NAME = "FAQs"
DEFAULT_WORKSHEET_TITLES = {"Sheet1", "Full 1"}


def get_oauth_client(oauth_client_json="oauth_client.json", token_file="token.json"):
    token_file = resolve_token_path(token_file)
    creds = None
    try:
        if os.path.exists(token_file):
            creds = OAuthCredentials.from_authorized_user_file(token_file, OAUTH_SCOPES)
    except Exception:
        creds = None

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(token_file, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
        except Exception:
            creds = None

    if not creds or not creds.valid:
        raise RuntimeError("No hi ha cap sessio Google activa. Inicia sessio amb Google des del navegador.")

    return gspread.authorize(creds)


def resolve_oauth_client_config(path: str = "oauth_client.json") -> dict:
    client_id = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    project_id = (os.getenv("GOOGLE_OAUTH_PROJECT_ID") or "").strip()

    if client_id and client_secret:
        return {
            "web": {
                "client_id": client_id,
                "project_id": project_id or "upc-faq-manager",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_secret": client_secret,
                "redirect_uris": [os.getenv("GOOGLE_OAUTH_REDIRECT_URI") or "http://localhost:8000/api/google/callback"],
            }
        }

    oauth_path = resolve_oauth_client_path(path)
    import json

    with open(oauth_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def create_google_authorization_url(
    *,
    oauth_client_json: str = "oauth_client.json",
    redirect_uri: str,
    state: str,
    code_verifier: str,
) -> str:
    oauth_client_config = resolve_oauth_client_config(oauth_client_json)
    flow = Flow.from_client_config(oauth_client_config, scopes=OAUTH_SCOPES, state=state)
    flow.redirect_uri = redirect_uri
    flow.code_verifier = code_verifier
    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        code_challenge_method="S256",
        prompt="consent",
    )
    return authorization_url


def exchange_google_authorization_code(
    *,
    oauth_client_json: str = "oauth_client.json",
    code: str,
    state: str,
    redirect_uri: str,
    code_verifier: str,
    token_file: str = "token.json",
) -> None:
    # Google can return an expanded granted scope set; allow oauthlib to accept it.
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
    oauth_client_config = resolve_oauth_client_config(oauth_client_json)
    flow = Flow.from_client_config(oauth_client_config, scopes=OAUTH_SCOPES, state=state)
    flow.redirect_uri = redirect_uri
    flow.code_verifier = code_verifier
    try:
        flow.fetch_token(code=code)
    except Exception as e:
        raise RuntimeError(f"OAuth error: {_format_google_error(e)}") from e

    creds = flow.credentials
    if creds is None:
        raise RuntimeError("Google no ha retornat credencials valides.")

    token_path = resolve_token_path(token_file)
    with open(token_path, "w", encoding="utf-8") as handle:
        handle.write(creds.to_json())


def resolve_oauth_client_path(path: str) -> str:
    candidate = (path or "").strip() or "oauth_client.json"
    raw = Path(candidate)
    if raw.is_absolute():
        if raw.exists():
            return str(raw)
        raise RuntimeError(f"No s'ha trobat el fitxer OAuth: {raw}")

    base_dir = Path(__file__).resolve().parents[2]
    sibling_scraper_dir = base_dir.parent / "Scraper"
    search_paths = [
        Path.cwd() / candidate,
        base_dir / candidate,
        base_dir / "backend" / candidate,
        base_dir / "backend" / "app" / candidate,
        base_dir / "tests" / candidate,
        sibling_scraper_dir / candidate,
        sibling_scraper_dir / "tests" / candidate,
    ]
    for item in search_paths:
        if item.exists():
            return str(item.resolve())

    searched = " | ".join(str(item) for item in search_paths)
    raise RuntimeError(
        f"No s'ha trobat el fitxer OAuth '{candidate}'. Rutes comprovades: {searched}"
    )


def resolve_token_path(path: str) -> str:
    p = (path or "").strip() or "token.json"
    if os.path.isabs(p):
        parent = os.path.dirname(p)
        if parent:
            os.makedirs(parent, exist_ok=True)
        return p
    appdata = os.getenv("APPDATA")
    if appdata:
        base_dir = os.path.join(appdata, "UPCFAQScraper")
    else:
        base_dir = os.path.join(os.path.expanduser("~"), ".upc_faq_scraper")
    os.makedirs(base_dir, exist_ok=True)
    resolved = os.path.join(base_dir, p)
    parent = os.path.dirname(resolved)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return resolved


def get_google_session_status(
    token_file: str = "token.json",
    oauth_client_json: str = "oauth_client.json",
) -> dict[str, str | bool | None]:
    resolved = resolve_token_path(token_file)
    connected = os.path.exists(resolved) and os.path.getsize(resolved) > 0
    env_configured = bool((os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip() and (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip())
    try:
        oauth_path = "env:GOOGLE_OAUTH_CLIENT_ID/SECRET" if env_configured else resolve_oauth_client_path(oauth_client_json)
        oauth_found = True
    except Exception:
        oauth_path = str(Path.cwd() / ((oauth_client_json or "").strip() or "oauth_client.json"))
        oauth_found = False
    profile_name = None
    profile_email = None
    profile_picture = None

    if connected:
        try:
            creds = _get_oauth_credentials(token_file=token_file)
            response = requests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {creds.token}"},
                timeout=10,
            )
            if response.ok:
                profile = response.json()
                profile_name = (profile.get("name") or "").strip() or None
                profile_email = (profile.get("email") or "").strip() or None
                profile_picture = (profile.get("picture") or "").strip() or None
        except Exception:
            profile_name = None
            profile_email = None
            profile_picture = None

    return {
        "connected": connected,
        "token_file": resolved,
        "account_hint": os.path.basename(resolved) if connected else None,
        "oauth_client_json": oauth_path,
        "oauth_client_found": oauth_found,
        "profile_name": profile_name,
        "profile_email": profile_email,
        "profile_picture": profile_picture,
    }


def logout_google_session(token_file: str = "token.json") -> dict[str, str | bool | None]:
    resolved = resolve_token_path(token_file)
    if os.path.exists(resolved):
        os.remove(resolved)
    return get_google_session_status(token_file)


def list_spreadsheets_oauth(
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
) -> list[str]:
    client = get_oauth_client(oauth_client_json=oauth_client_json, token_file=token_file)
    files = client.list_spreadsheet_files()
    titles = sorted({(item.get("name") or "").strip() for item in files if (item.get("name") or "").strip()})
    return titles


def _get_oauth_credentials(token_file: str = "token.json") -> OAuthCredentials:
    resolved = resolve_token_path(token_file)
    if not os.path.exists(resolved):
        raise RuntimeError("No hi ha cap sessio Google activa. Inicia sessio amb Google des del navegador.")

    try:
        creds = OAuthCredentials.from_authorized_user_file(resolved, OAUTH_SCOPES)
    except Exception as exc:
        raise RuntimeError(f"No s'han pogut carregar les credencials de Google: {_format_google_error(exc)}") from exc

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(resolved, "w", encoding="utf-8") as handle:
                handle.write(creds.to_json())
        except Exception as exc:
            raise RuntimeError(f"No s'ha pogut refrescar la sessio Google: {_format_google_error(exc)}") from exc

    if not creds.valid:
        raise RuntimeError("No hi ha cap sessio Google activa. Inicia sessio amb Google des del navegador.")

    return creds


def list_drive_items_oauth(
    *,
    token_file: str = "token.json",
    parent_id: str | None = None,
    include_files: bool = False,
) -> list[dict[str, str]]:
    creds = _get_oauth_credentials(token_file=token_file)
    mime_filters = [
        "mimeType = 'application/vnd.google-apps.folder'",
        "mimeType = 'application/vnd.google-apps.spreadsheet'",
    ]
    if include_files:
        mime_filters.append("mimeType != 'application/vnd.google-apps.folder'")
    query_parent = (parent_id or "root").strip() or "root"
    query = (
        f"'{query_parent}' in parents and trashed = false and "
        f"({' or '.join(mime_filters)})"
    )
    params = {
        "q": query,
        "fields": "files(id,name,mimeType)",
        "orderBy": "folder,name_natural",
        "pageSize": "100",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }
    headers = {"Authorization": f"Bearer {creds.token}"}

    try:
        response = requests.get("https://www.googleapis.com/drive/v3/files", params=params, headers=headers, timeout=20)
        response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"No s'han pogut llistar els elements de Drive: {_format_google_error(exc)}") from exc

    files = response.json().get("files") or []
    items = []
    for item in files:
        mime_type = (item.get("mimeType") or "").strip()
        if mime_type == "application/vnd.google-apps.folder":
            kind = "folder"
        elif mime_type == "application/vnd.google-apps.spreadsheet":
            kind = "spreadsheet"
        elif include_files:
            kind = "file"
        else:
            continue
        items.append(
            {
                "id": (item.get("id") or "").strip(),
                "name": (item.get("name") or "").strip(),
                "mime_type": mime_type,
                "kind": kind,
            }
        )
    return items


def list_worksheets_oauth(
    *,
    token_file: str = "token.json",
    spreadsheet_id: str,
) -> list[str]:
    client = get_oauth_client(token_file=token_file)
    try:
        spreadsheet = client.open_by_key((spreadsheet_id or "").strip())
    except Exception as exc:
        raise RuntimeError(f"No s'ha pogut obrir el Google Sheet seleccionat: {_format_google_error(exc)}") from exc

    try:
        return [worksheet.title for worksheet in spreadsheet.worksheets() if (worksheet.title or "").strip()]
    except Exception as exc:
        raise RuntimeError(f"No s'han pogut llegir les pestanyes del Google Sheet: {_format_google_error(exc)}") from exc


def _drive_api_json(
    *,
    method: str,
    creds: OAuthCredentials,
    path: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {creds.token}"}
    response = requests.request(
        method=method.upper(),
        url=f"https://www.googleapis.com/drive/v3/{path.lstrip('/')}",
        params=params,
        json=json_body,
        headers=headers,
        timeout=20,
    )
    try:
        response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(_format_google_error(exc)) from exc
    return response.json() if response.content else {}


def _escape_drive_query_value(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace("'", "\\'")


def _find_drive_folder(*, creds: OAuthCredentials, parent_id: str, name: str) -> dict[str, str] | None:
    query = (
        f"'{parent_id}' in parents and trashed = false and "
        "mimeType = 'application/vnd.google-apps.folder' and "
        f"name = '{_escape_drive_query_value(name)}'"
    )
    data = _drive_api_json(
        method="GET",
        creds=creds,
        path="files",
        params={
            "q": query,
            "fields": "files(id,name)",
            "pageSize": "10",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        },
    )
    files = data.get("files") or []
    return files[0] if files else None


def _create_drive_folder(*, creds: OAuthCredentials, parent_id: str, name: str) -> dict[str, str]:
    return _drive_api_json(
        method="POST",
        creds=creds,
        path="files",
        params={"fields": "id,name", "supportsAllDrives": "true"},
        json_body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
    )


def _find_drive_file(*, creds: OAuthCredentials, parent_id: str, name: str) -> dict[str, str] | None:
    query = (
        f"'{parent_id}' in parents and trashed = false and "
        "mimeType != 'application/vnd.google-apps.folder' and "
        f"name = '{_escape_drive_query_value(name)}'"
    )
    data = _drive_api_json(
        method="GET",
        creds=creds,
        path="files",
        params={
            "q": query,
            "fields": "files(id,name,mimeType)",
            "pageSize": "10",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        },
    )
    files = data.get("files") or []
    return files[0] if files else None


def _find_drive_spreadsheet(*, creds: OAuthCredentials, parent_id: str, name: str) -> dict[str, str] | None:
    query = (
        f"'{parent_id}' in parents and trashed = false and "
        "mimeType = 'application/vnd.google-apps.spreadsheet' and "
        f"name = '{_escape_drive_query_value(name)}'"
    )
    data = _drive_api_json(
        method="GET",
        creds=creds,
        path="files",
        params={
            "q": query,
            "fields": "files(id,name)",
            "pageSize": "10",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        },
    )
    files = data.get("files") or []
    return files[0] if files else None


def _create_drive_spreadsheet(*, creds: OAuthCredentials, parent_id: str, name: str) -> dict[str, str]:
    return _drive_api_json(
        method="POST",
        creds=creds,
        path="files",
        params={"fields": "id,name", "supportsAllDrives": "true"},
        json_body={
            "name": name,
            "mimeType": "application/vnd.google-apps.spreadsheet",
            "parents": [parent_id],
        },
    )


def _resolve_fixed_faqs_folder(*, creds: OAuthCredentials, create_missing: bool) -> dict[str, dict[str, str]]:
    root_folder = _find_drive_folder(creds=creds, parent_id="root", name=FIXED_DRIVE_ROOT_FOLDER)
    if root_folder is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat cap document '{FIXED_SPREADSHEET_TITLE}' a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}."
            )
        root_folder = _create_drive_folder(creds=creds, parent_id="root", name=FIXED_DRIVE_ROOT_FOLDER)

    faqs_folder = _find_drive_folder(creds=creds, parent_id=root_folder["id"], name=FIXED_DRIVE_FAQS_FOLDER)
    if faqs_folder is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat cap document '{FIXED_SPREADSHEET_TITLE}' a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}."
            )
        faqs_folder = _create_drive_folder(creds=creds, parent_id=root_folder["id"], name=FIXED_DRIVE_FAQS_FOLDER)

    return {"root_folder": root_folder, "faqs_folder": faqs_folder}


def _resolve_fixed_configs_folder(*, creds: OAuthCredentials, create_missing: bool) -> dict[str, dict[str, str]]:
    folders = _resolve_fixed_faqs_folder(creds=creds, create_missing=create_missing)
    configs_folder = _find_drive_folder(
        creds=creds,
        parent_id=folders["faqs_folder"]["id"],
        name=FIXED_DRIVE_CONFIGS_FOLDER,
    )
    if configs_folder is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat la carpeta {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}/{FIXED_DRIVE_CONFIGS_FOLDER}."
            )
        configs_folder = _create_drive_folder(
            creds=creds,
            parent_id=folders["faqs_folder"]["id"],
            name=FIXED_DRIVE_CONFIGS_FOLDER,
        )
    return {"root_folder": folders["root_folder"], "faqs_folder": folders["faqs_folder"], "configs_folder": configs_folder}


def list_fixed_faqs_spreadsheets_oauth(*, token_file: str = "token.json") -> list[dict[str, str]]:
    creds = _get_oauth_credentials(token_file=token_file)
    folders = _resolve_fixed_faqs_folder(creds=creds, create_missing=False)
    items = list_drive_items_oauth(token_file=token_file, parent_id=folders["faqs_folder"]["id"])
    return [item for item in items if item.get("kind") == "spreadsheet"]


def list_fixed_config_files_oauth(*, token_file: str = "token.json") -> list[dict[str, str]]:
    creds = _get_oauth_credentials(token_file=token_file)
    folders = _resolve_fixed_configs_folder(creds=creds, create_missing=True)
    items = list_drive_items_oauth(
        token_file=token_file,
        parent_id=folders["configs_folder"]["id"],
        include_files=True,
    )
    return [
        item
        for item in items
        if item.get("kind") == "file" and (item.get("name", "") or "").strip().lower().endswith(".csv")
    ]


def read_drive_text_file_oauth(*, token_file: str = "token.json", file_id: str) -> dict[str, str]:
    creds = _get_oauth_credentials(token_file=token_file)
    clean_file_id = (file_id or "").strip()
    if not clean_file_id:
        raise RuntimeError("Falta l'identificador del fitxer.")

    headers = {"Authorization": f"Bearer {creds.token}"}
    try:
        metadata = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{clean_file_id}",
            params={"fields": "id,name,mimeType", "supportsAllDrives": "true"},
            headers=headers,
            timeout=20,
        )
        metadata.raise_for_status()
        meta_json = metadata.json()
        response = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{clean_file_id}",
            params={"alt": "media", "supportsAllDrives": "true"},
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"No s'ha pogut llegir el fitxer de Drive: {_format_google_error(exc)}") from exc

    return {
        "file_id": clean_file_id,
        "name": (meta_json.get("name") or "").strip(),
        "content": response.text,
    }


def save_config_text_to_drive_oauth(*, token_file: str = "token.json", name: str, content: str) -> dict[str, str]:
    creds = _get_oauth_credentials(token_file=token_file)
    folders = _resolve_fixed_configs_folder(creds=creds, create_missing=True)
    clean_name = (name or "").strip()
    if not clean_name:
        raise RuntimeError("Cal indicar un nom de configuracio.")
    if not clean_name.lower().endswith(".csv"):
        clean_name = f"{clean_name}.csv"

    existing = _find_drive_file(
        creds=creds,
        parent_id=folders["configs_folder"]["id"],
        name=clean_name,
    )

    metadata = {"name": clean_name}
    if existing is None:
        metadata["parents"] = [folders["configs_folder"]["id"]]

    boundary = "upcfaqconfigboundary"
    multipart_body = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{json.dumps(metadata)}\r\n"
        f"--{boundary}\r\n"
        "Content-Type: text/csv; charset=UTF-8\r\n\r\n"
        f"{content}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": f"multipart/related; boundary={boundary}",
    }
    url = "https://www.googleapis.com/upload/drive/v3/files"
    method = "POST"
    params = {"uploadType": "multipart", "supportsAllDrives": "true", "fields": "id,name"}
    if existing is not None:
        url = f"{url}/{existing['id']}"
        method = "PATCH"

    try:
        response = requests.request(method=method, url=url, params=params, headers=headers, data=multipart_body, timeout=30)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"No s'ha pogut guardar la configuracio a Drive: {_format_google_error(exc)}") from exc

    return {"file_id": (payload.get("id") or "").strip(), "name": (payload.get("name") or clean_name).strip()}


def share_drive_file_with_user_oauth(
    *,
    token_file: str = "token.json",
    file_id: str,
    email: str,
    role: str = "writer",
) -> None:
    creds = _get_oauth_credentials(token_file=token_file)
    clean_file_id = (file_id or "").strip()
    clean_email = (email or "").strip()
    clean_role = (role or "writer").strip()
    if not clean_file_id:
        raise RuntimeError("Falta l'identificador del fitxer a compartir.")
    if not clean_email:
        raise RuntimeError("Falta l'adreca de correu de la persona amb qui compartir el fitxer.")
    if clean_role not in {"reader", "writer", "commenter"}:
        raise RuntimeError("El rol de comparticio ha de ser reader, writer o commenter.")

    _drive_api_json(
        method="POST",
        creds=creds,
        path=f"files/{clean_file_id}/permissions",
        params={
            "sendNotificationEmail": "true",
            "supportsAllDrives": "true",
            "fields": "id",
        },
        json_body={
            "type": "user",
            "role": clean_role,
            "emailAddress": clean_email,
        },
    )


def ensure_fixed_faqs_spreadsheet_oauth(
    *,
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    log=None,
    create_missing: bool = True,
) -> dict[str, str]:
    def _log(message: str):
        if log:
            log(message)

    creds = _get_oauth_credentials(token_file=token_file)
    client = get_oauth_client(oauth_client_json=oauth_client_json, token_file=token_file)

    root_folder = _find_drive_folder(creds=creds, parent_id="root", name=FIXED_DRIVE_ROOT_FOLDER)
    if root_folder is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat cap document '{FIXED_SPREADSHEET_TITLE}' a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}."
            )
        root_folder = _create_drive_folder(creds=creds, parent_id="root", name=FIXED_DRIVE_ROOT_FOLDER)
        _log(f"Carpeta creada a l'arrel de Drive: {FIXED_DRIVE_ROOT_FOLDER}")
    else:
        _log(f"Carpeta trobada a l'arrel de Drive: {FIXED_DRIVE_ROOT_FOLDER}")

    faqs_folder = _find_drive_folder(creds=creds, parent_id=root_folder["id"], name=FIXED_DRIVE_FAQS_FOLDER)
    if faqs_folder is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat cap document '{FIXED_SPREADSHEET_TITLE}' a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}."
            )
        faqs_folder = _create_drive_folder(creds=creds, parent_id=root_folder["id"], name=FIXED_DRIVE_FAQS_FOLDER)
        _log(f"Carpeta creada dins de {FIXED_DRIVE_ROOT_FOLDER}: {FIXED_DRIVE_FAQS_FOLDER}")
    else:
        _log(f"Carpeta trobada dins de {FIXED_DRIVE_ROOT_FOLDER}: {FIXED_DRIVE_FAQS_FOLDER}")

    spreadsheet = _find_drive_spreadsheet(creds=creds, parent_id=faqs_folder["id"], name=FIXED_SPREADSHEET_TITLE)
    if spreadsheet is None:
        if not create_missing:
            raise RuntimeError(
                f"No s'ha trobat cap document '{FIXED_SPREADSHEET_TITLE}' a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}."
            )
        spreadsheet = _create_drive_spreadsheet(creds=creds, parent_id=faqs_folder["id"], name=FIXED_SPREADSHEET_TITLE)
        _log(f"Google Sheet creat a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}: {FIXED_SPREADSHEET_TITLE}")
    else:
        _log(f"Google Sheet trobat a {FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}: {FIXED_SPREADSHEET_TITLE}")

    sh = client.open_by_key(spreadsheet["id"])
    return {
        "spreadsheet_id": spreadsheet["id"],
        "spreadsheet_title": sh.title,
        "worksheet_name": FIXED_WORKSHEET_NAME,
        "folder_path": f"{FIXED_DRIVE_ROOT_FOLDER}/{FIXED_DRIVE_FAQS_FOLDER}",
    }


def _format_google_error(e: Exception) -> str:
    response = getattr(e, "response", None)
    if response is not None:
        code = getattr(response, "status_code", "?")
        txt = ""
        try:
            txt = (response.text or "").strip()
        except Exception:
            txt = ""
        if txt:
            txt = re.sub(r"\s+", " ", txt)
            return f"HTTP {code} - {txt[:300]}"
        return f"HTTP {code}"
    return str(e)


def _is_empty_worksheet(worksheet) -> bool:
    try:
        values = worksheet.get_all_values()
    except Exception:
        return False
    return not values or all((not row) or all((cell or "").strip() == "" for cell in row) for row in values)


def _cleanup_default_worksheets(spreadsheet, keep_title: str, log=None) -> None:
    def _log(message: str):
        if log:
            log(message)

    keep = (keep_title or "").strip()
    try:
        worksheets = spreadsheet.worksheets()
    except Exception:
        return

    removable = []
    for worksheet in worksheets:
        title = (worksheet.title or "").strip()
        if not title or title == keep:
            continue
        if title in DEFAULT_WORKSHEET_TITLES and _is_empty_worksheet(worksheet):
            removable.append(worksheet)

    if len(worksheets) - len(removable) < 1:
        return

    for worksheet in removable:
        try:
            spreadsheet.del_worksheet(worksheet)
            _log(f"Pestanya buida eliminada: {worksheet.title}")
        except Exception:
            continue


def _open_sheet_lenient(client, spreadsheet_title: str, log=None):
    def _log(m: str):
        if log:
            log(m)

    title = (spreadsheet_title or "").strip()
    if not title:
        raise RuntimeError("El títol del Google Sheet està buit.")

    _log(f"Intentant obrir Google Sheet per títol exacte: {title}")
    try:
        return client.open(title)
    except Exception:
        pass

    # Fallback més lleuger que openall(): consulta de fitxers de spreadsheet.
    try:
        files = client.list_spreadsheet_files()
    except Exception as e:
        raise RuntimeError(f"No s'han pogut llistar els teus Google Sheets: {_format_google_error(e)}") from e

    normalized = title.casefold()
    exact_ci = [f for f in files if (f.get("name", "") or "").strip().casefold() == normalized]
    if exact_ci:
        key = exact_ci[0].get("id")
        if key:
            _log(f"Sheet trobat (coincidència insensitive): {exact_ci[0].get('name', '')}")
            return client.open_by_key(key)

    partial = [f for f in files if normalized in (f.get("name", "") or "").strip().casefold()]
    if len(partial) == 1:
        key = partial[0].get("id")
        if key:
            _log(f"Sheet trobat (coincidència parcial única): {partial[0].get('name', '')}")
            return client.open_by_key(key)

    sample = ", ".join((f.get("name", "") or "") for f in files[:8])
    if partial:
        opts = ", ".join((f.get("name", "") or "") for f in partial[:8])
        raise RuntimeError(
            f"No s'ha trobat una coincidència única per '{title}'. Coincidències: {opts}"
        )

    raise RuntimeError(
        f"No s'ha trobat cap Google Sheet amb títol '{title}'. "
        f"Comprova compte Google autoritzat i títol exacte. Exemples trobats: {sample}"
    )


def get_client(credentials_json: str):
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = ServiceAccountCredentials.from_service_account_file(credentials_json, scopes=scopes)
    return gspread.authorize(creds)


def open_sheet_by_title(client, spreadsheet_title: str):
    return client.open(spreadsheet_title)


def open_or_create_worksheet(sh, worksheet_name: str, rows: int = 1000, cols: int = 12):
    try:
        return sh.worksheet(worksheet_name)
    except Exception:
        return sh.add_worksheet(title=worksheet_name, rows=rows, cols=cols)


def export_rows_to_google_sheets_oauth(
    rows: List[List[str]],
    spreadsheet_title: str,
    worksheet_name: str,
    spreadsheet_id: str | None = None,
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    log=None,
):
    data_start_row = 5

    def _log(m: str):
        if log:
            log(m)

    def _norm(s: str) -> str:
        s = (s or "").replace("\u00a0", " ")
        return re.sub(r"\s+", " ", s).strip()

    def _qkey(row: List[str]) -> tuple[str, str, str]:
        topic = _norm(row[0]) if len(row) > 0 else ""
        pregunta = _norm(row[2]) if len(row) > 2 else ""
        font = _norm(row[9]) if len(row) > 9 else ""
        return (topic, pregunta, font)

    def _ans(row: List[str]) -> str:
        return _norm(row[3]) if len(row) > 3 else ""

    def _html_to_sheet_text(value: str) -> str:
        text = (value or "").strip()
        if not text or ("<" not in text or ">" not in text):
            return text

        try:
            soup = BeautifulSoup(text, "html.parser")
        except Exception:
            return text

        def _render(node) -> str:
            if isinstance(node, NavigableString):
                return str(node)

            name = getattr(node, "name", "") or ""
            name = name.lower()

            if name == "br":
                return "\n"

            if name == "a":
                href = (node.get("href") or "").strip()
                label = "".join(_render(c) for c in node.children).strip()
                if href and label and label != href:
                    return f"{label} ({href})"
                return href or label

            inner = "".join(_render(c) for c in node.children)

            if name in {"b", "strong"}:
                return f"**{inner.strip()}**" if inner.strip() else ""
            if name in {"i", "em"}:
                return f"*{inner.strip()}*" if inner.strip() else ""
            if name == "li":
                return f"- {inner.strip()}\n" if inner.strip() else ""
            if name in {"p", "div"}:
                return f"{inner.strip()}\n\n" if inner.strip() else ""
            if name in {"ul", "ol"}:
                return f"{inner.strip()}\n" if inner.strip() else ""

            return inner

        rendered = "".join(_render(n) for n in soup.contents)
        rendered = rendered.replace("\r\n", "\n").replace("\r", "\n")
        rendered = re.sub(r"\n{3,}", "\n\n", rendered)
        rendered = re.sub(r"[ \t]+", " ", rendered)
        rendered = re.sub(r" *\n *", "\n", rendered)
        return rendered.strip()

    def _ensure_sheet_headers(worksheet, current_values: List[List[str]]) -> List[List[str]]:
        expected = list(SHEETS_COLUMNS)
        current_header = current_values[0] if current_values else []
        normalized_current = [_norm(cell) for cell in current_header[: len(expected)]]
        normalized_expected = [_norm(cell) for cell in expected]

        if worksheet.col_count < len(expected):
            worksheet.add_cols(len(expected) - worksheet.col_count)

        if not current_values:
            worksheet.update("A1:J1", [expected], value_input_option="RAW")
            _log("Capcalera creada a la primera fila")
            return [expected]

        if normalized_current == normalized_expected:
            return current_values

        worksheet.insert_row(expected, index=1, value_input_option="RAW")
        _log("Capcalera afegida a la primera fila")
        return [expected, *current_values]

    def _apply_empty_sheet_layout(spreadsheet, worksheet, total_rows: int) -> None:
        sheet_id = int(worksheet.id)
        total_columns = len(SHEETS_COLUMNS)
        end_row_index = max(worksheet.row_count, total_rows + 25)
        status_values = [{"userEnteredValue": value} for value in ("Pendent", "Aprovat", "Rebutjat")]
        preferred_widths = {
            0: 130,  # Tema
            1: 165,  # Subtopic
            3: 520,  # Resposta
            4: 100,  # Estat
        }

        requests = [
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 0,
                        "endRowIndex": end_row_index,
                        "startColumnIndex": 0,
                        "endColumnIndex": total_columns,
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "wrapStrategy": "WRAP",
                            "verticalAlignment": "TOP",
                        }
                    },
                    "fields": "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
                }
            },
            {
                "setDataValidation": {
                    "range": {
                        "sheetId": sheet_id,
                        "startRowIndex": 1,
                        "endRowIndex": end_row_index,
                        "startColumnIndex": 4,
                        "endColumnIndex": 5,
                    },
                    "rule": {
                        "condition": {
                            "type": "ONE_OF_LIST",
                            "values": status_values,
                        },
                        "showCustomUi": True,
                        "strict": False,
                    },
                }
            },
            {
                "autoResizeDimensions": {
                    "dimensions": {
                        "sheetId": sheet_id,
                        "dimension": "COLUMNS",
                        "startIndex": 0,
                        "endIndex": total_columns,
                    }
                }
            },
        ]

        for column_index, pixel_size in preferred_widths.items():
            requests.append(
                {
                    "updateDimensionProperties": {
                        "range": {
                            "sheetId": sheet_id,
                            "dimension": "COLUMNS",
                            "startIndex": column_index,
                            "endIndex": column_index + 1,
                        },
                        "properties": {
                            "pixelSize": pixel_size,
                        },
                        "fields": "pixelSize",
                    }
                }
            )

        spreadsheet.batch_update(
            {
                "requests": requests
            }
        )
        _log("Format inicial aplicat: ajust, alineacio superior, amplades de columna i desplegable d'Estat")

    def _clear_existing_data_block(worksheet) -> None:
        existing_values = worksheet.get(f"A{data_start_row}:J")
        if not existing_values:
            return

        max_row = data_start_row - 1
        for index, row in enumerate(existing_values, start=data_start_row):
            if any((cell or "").strip() for cell in row):
                max_row = index

        if max_row < data_start_row:
            return

        worksheet.batch_clear([f"A{data_start_row}:J{max_row}"])
        _log(f"Bloc de dades netejat: A{data_start_row}:J{max_row}")

    client = get_oauth_client(oauth_client_json=oauth_client_json, token_file=token_file)

    spreadsheet_key = (spreadsheet_id or "").strip()
    if spreadsheet_key:
        try:
            sh = client.open_by_key(spreadsheet_key)
            _log(f"Spreadsheet obert per ID: {sh.title}")
        except Exception as exc:
            raise RuntimeError(f"No s'ha pogut obrir el Google Sheet seleccionat: {_format_google_error(exc)}") from exc
    else:
        try:
            sh = _open_sheet_lenient(client, spreadsheet_title, log=log)
            _log(f"Spreadsheet obert: {sh.title}")
        except Exception:
            sh = client.create(spreadsheet_title)
            _log(f"Spreadsheet creat: {spreadsheet_title}")

    try:
        ws = sh.worksheet(worksheet_name)
        _log(f"Pestanya oberta: {worksheet_name}")
    except Exception:
        worksheets = sh.worksheets()
        default_ws = (
            worksheets[0]
            if len(worksheets) == 1 and (worksheets[0].title or "").strip() in DEFAULT_WORKSHEET_TITLES
            else None
        )
        if default_ws is not None:
            default_ws.update_title(worksheet_name)
            ws = default_ws
            _log(f"Pestanya renombrada a: {worksheet_name}")
        else:
            ws = sh.add_worksheet(
                title=worksheet_name,
                rows=max(1000, len(rows) + 10),
                cols=max(11, len(SHEETS_COLUMNS)),
            )
            _log(f"Pestanya creada: {worksheet_name}")

    _cleanup_default_worksheets(sh, worksheet_name, log=log)

    values = ws.get_all_values()
    is_truly_empty = not values or all((not r) or all((c or "").strip() == "" for c in r) for r in values)
    if is_truly_empty:
        ws.clear()
        values = []
    data_start_row = 2 if is_truly_empty else 5

    values = _ensure_sheet_headers(ws, values)
    _log(f"Capcalera validada amb {len(SHEETS_COLUMNS)} columnes")

    first_created: dict[tuple[str, str, str], str] = {}
    existing_answers: dict[tuple[str, str, str], set[str]] = {}

    for r in values[1:]:
        k = _qkey(r)
        created = (r[5] if len(r) > 5 else "").strip()
        if created and k not in first_created:
            first_created[k] = created

        a = _ans(r)
        if a:
            existing_answers.setdefault(k, set()).add(a)

    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    to_append: List[List[str]] = []
    skipped = 0

    for r in rows:
        rr = r.copy()
        if len(rr) > 3:
            rr[3] = _html_to_sheet_text(rr[3])
        k = _qkey(rr)
        a = _ans(rr)

        rr[5] = first_created.get(k, rr[5] or now_ts)
        rr[6] = now_ts

        seen = existing_answers.setdefault(k, set())
        if a in seen:
            skipped += 1
            continue

        seen.add(a)
        first_created.setdefault(k, rr[5])
        to_append.append(rr)

    _log(f"Saltades (mateixa resposta): {skipped} | Noves (resposta diferent): {len(to_append)}")

    if to_append:
        _clear_existing_data_block(ws)
        start_row = data_start_row
        end_row = start_row + len(to_append) - 1
        ws.update(f"A{start_row}:J{end_row}", to_append, value_input_option="RAW")
        _log(f"Rows escrites: {len(to_append)} (A{start_row}:J{end_row})")
    else:
        _log("No s'ha afegit res (tot eren duplicats de resposta).")

    if is_truly_empty:
        _apply_empty_sheet_layout(sh, ws, data_start_row + max(len(to_append), 1))

    try:
        ws.update_acell("K1", f"LAST_WRITE: {now_ts}")
    except Exception:
        # Fallback per pestanyes antigues amb menys columnes.
        ws.update_acell("I1", f"LAST_WRITE: {now_ts}")


def read_rows_from_sheets_oauth(
    spreadsheet_title: str,
    worksheet_name: str,
    spreadsheet_id: str | None = None,
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    log=None,
    create_if_missing: bool = False,
) -> List[Dict[str, str]]:
    def _log(m: str):
        if log:
            log(m)

    _log("Google Sheets: autenticant…")
    try:
        client = get_oauth_client(oauth_client_json=oauth_client_json, token_file=token_file)
    except Exception as e:
        raise RuntimeError(f"No s'ha pogut autenticar amb Google: {_format_google_error(e)}") from e

    _log(f"Google Sheets: obrint sheet '{spreadsheet_title}'…")
    spreadsheet_key = (spreadsheet_id or "").strip()
    try:
        if spreadsheet_key:
            sh = client.open_by_key(spreadsheet_key)
        else:
            sh = _open_sheet_lenient(client, spreadsheet_title, log=log)
    except Exception as e:
        if create_if_missing:
            _log(f"Google Sheets: el sheet '{spreadsheet_title}' no existeix, es crearà…")
            try:
                sh = client.create(spreadsheet_title)
                _log(f"Google Sheets: sheet creat: {spreadsheet_title}")
            except Exception as create_e:
                raise RuntimeError(
                    f"No s'ha pogut crear el Google Sheet '{spreadsheet_title}': {_format_google_error(create_e)}"
                ) from create_e
        else:
            raise RuntimeError(
                f"No s'ha pogut obrir el Google Sheet '{spreadsheet_title}': {_format_google_error(e)}"
            ) from e

    _log(f"Google Sheets: obrint pestanya '{worksheet_name}'…")
    try:
        ws = sh.worksheet(worksheet_name)
    except Exception as e:
        if create_if_missing:
            _log(f"Google Sheets: la pestanya '{worksheet_name}' no existeix, es crearà…")
            try:
                ws = sh.add_worksheet(
                    title=worksheet_name,
                    rows=1000,
                    cols=max(11, len(SHEETS_COLUMNS)),
                )
                ws.append_row(SHEETS_COLUMNS, value_input_option="RAW")
                _log(f"Google Sheets: pestanya creada: {worksheet_name}")
            except Exception as create_e:
                raise RuntimeError(
                    f"No s'ha pogut crear la pestanya '{worksheet_name}' al sheet '{spreadsheet_title}': "
                    f"{_format_google_error(create_e)}"
                ) from create_e
        else:
            raise RuntimeError(
                f"No s'ha trobat la pestanya '{worksheet_name}' al sheet '{spreadsheet_title}': {_format_google_error(e)}"
            ) from e

    _log("Google Sheets: llegint files…")
    try:
        values = ws.get_all_values()
    except Exception as e:
        raise RuntimeError(
            f"No s'han pogut llegir files de '{spreadsheet_title}/{worksheet_name}': {_format_google_error(e)}"
        ) from e
    if not values or len(values) < 2:
        return []

    header = [h.strip() for h in values[0]]
    out: List[Dict[str, str]] = []
    for row in values[1:]:
        d: Dict[str, str] = {}
        for i, col in enumerate(header):
            d[col] = (row[i] if i < len(row) else "").strip()
        out.append(d)
    return out
