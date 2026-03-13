import os
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List
from bs4 import BeautifulSoup, NavigableString

import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials as OAuthCredentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from google_auth_oauthlib.flow import InstalledAppFlow

try:
    from .constants import OAUTH_SCOPES, SHEETS_COLUMNS
except ImportError:
    from constants import OAUTH_SCOPES, SHEETS_COLUMNS


def get_oauth_client(oauth_client_json="oauth_client.json", token_file="token.json"):
    token_file = resolve_token_path(token_file)
    oauth_client_config = resolve_oauth_client_config(oauth_client_json)
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
        try:
            flow = InstalledAppFlow.from_client_config(oauth_client_config, OAUTH_SCOPES)
            creds = flow.run_local_server(port=0)
            with open(token_file, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
        except Exception as e:
            raise RuntimeError(f"OAuth error: {_format_google_error(e)}") from e

    return gspread.authorize(creds)


def resolve_oauth_client_config(path: str = "oauth_client.json") -> dict:
    client_id = (os.getenv("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    project_id = (os.getenv("GOOGLE_OAUTH_PROJECT_ID") or "").strip()

    if client_id and client_secret:
        return {
            "installed": {
                "client_id": client_id,
                "project_id": project_id or "upc-faq-manager",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_secret": client_secret,
                "redirect_uris": ["http://localhost"],
            }
        }

    oauth_path = resolve_oauth_client_path(path)
    import json

    with open(oauth_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


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
        return p
    appdata = os.getenv("APPDATA")
    if appdata:
        base_dir = os.path.join(appdata, "UPCFAQScraper")
    else:
        base_dir = os.path.join(os.path.expanduser("~"), ".upc_faq_scraper")
    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, p)


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
    return {
        "connected": connected,
        "token_file": resolved,
        "account_hint": os.path.basename(resolved) if connected else None,
        "oauth_client_json": oauth_path,
        "oauth_client_found": oauth_found,
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
    oauth_client_json: str = "oauth_client.json",
    token_file: str = "token.json",
    log=None,
):
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

    client = get_oauth_client(oauth_client_json=oauth_client_json, token_file=token_file)

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
        ws = sh.add_worksheet(
            title=worksheet_name,
            rows=max(1000, len(rows) + 10),
            cols=max(11, len(SHEETS_COLUMNS)),
        )
        _log(f"Pestanya creada: {worksheet_name}")

    values = ws.get_all_values()
    is_truly_empty = not values or all((not r) or all((c or "").strip() == "" for c in r) for r in values)
    if is_truly_empty:
        ws.clear()
        ws.append_row(SHEETS_COLUMNS, value_input_option="RAW")
        _log("Capçalera afegida")
        values = [SHEETS_COLUMNS]

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
        ws.append_rows(to_append, value_input_option="RAW")
        _log(f"Rows appended: {len(to_append)}")
    else:
        _log("No s'ha afegit res (tot eren duplicats de resposta).")

    try:
        ws.update_acell("K1", f"LAST_WRITE: {now_ts}")
    except Exception:
        # Fallback per pestanyes antigues amb menys columnes.
        ws.update_acell("I1", f"LAST_WRITE: {now_ts}")


def read_rows_from_sheets_oauth(
    spreadsheet_title: str,
    worksheet_name: str,
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
    try:
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
