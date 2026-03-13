from __future__ import annotations

import html
import re
from collections import OrderedDict
from typing import Any

from bs4 import BeautifulSoup


APPROVED_VALUES = {"aprovat", "aprovada", "approved"}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _looks_like_html(text: str) -> bool:
    t = _clean_text(text)
    return "<" in t and ">" in t


def _answer_to_html(answer: str) -> str:
    if _looks_like_html(answer):
        return answer.strip()

    escaped = html.escape(_clean_text(answer))
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n")
    escaped = escaped.replace("\n\n", "<br /><br />")
    return escaped.replace("\n", "<br />")


def _answer_to_html_paragraph(answer: str) -> str:
    return _answer_to_html(answer)


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _clean_text(value).lower()).strip("-")
    return slug or "bloc"


def filter_approved(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    out = []
    for row in rows:
        status = _clean_text(row.get("Estat") or row.get("estat")).lower()
        if status in APPROVED_VALUES:
            out.append(row)
    return out


def normalize_row_dict(row: dict[str, Any]) -> dict[str, str]:
    return {
        "Tema": _clean_text(row.get("Tema") or row.get("topic") or row.get("Topic")),
        "Subtopic": _clean_text(row.get("Subtopic") or row.get("subtopic") or row.get("Subtòpic")),
        "Pregunta": _clean_text(row.get("Pregunta") or row.get("question") or row.get("Question")),
        "Resposta": _clean_text(row.get("Resposta") or row.get("answer") or row.get("Answer")),
        "Estat": _clean_text(row.get("Estat") or row.get("status") or row.get("Status")),
        "Data creació": _clean_text(row.get("Data creació") or row.get("created_at")),
        "Darrera modificació": _clean_text(row.get("Darrera modificació") or row.get("updated_at")),
        "Persona darrera modificació": _clean_text(
            row.get("Persona darrera modificació") or row.get("last_modified_by")
        ),
        "Dades amb actualització anual": _clean_text(
            row.get("Dades amb actualització anual") or row.get("annual_update")
        ),
        "Font": _clean_text(row.get("Font") or row.get("source") or row.get("URL")),
    }


def approved_rows_to_records(rows: list[list[Any]]) -> list[dict[str, str]]:
    records = []
    for row in rows:
        normalized = normalize_row_dict(
            {
                "Tema": row[0] if len(row) > 0 else "",
                "Subtopic": row[1] if len(row) > 1 else "",
                "Pregunta": row[2] if len(row) > 2 else "",
                "Resposta": row[3] if len(row) > 3 else "",
                "Estat": row[4] if len(row) > 4 else "Aprovat",
                "Data creació": row[5] if len(row) > 5 else "",
                "Darrera modificació": row[6] if len(row) > 6 else "",
                "Persona darrera modificació": row[7] if len(row) > 7 else "",
                "Dades amb actualització anual": row[8] if len(row) > 8 else "",
                "Font": row[9] if len(row) > 9 else "",
            }
        )
        records.append(normalized)
    return records


def apply_default_subtopics(rows: list[dict[str, str]], default_value: str = "-") -> list[dict[str, str]]:
    normalized_rows: list[dict[str, str]] = []
    for row in rows:
        normalized = dict(row)
        if not _clean_text(normalized.get("Subtopic")):
            normalized["Subtopic"] = default_value
        normalized_rows.append(normalized)
    return normalized_rows


def validate_subtopics(rows: list[dict[str, str]], require_for_approved: bool = True) -> None:
    for index, row in enumerate(rows, start=1):
        topic = _clean_text(row.get("Tema"))
        question = _clean_text(row.get("Pregunta"))
        answer = _clean_text(row.get("Resposta"))
        if not topic or not question or not answer:
            raise ValueError(f"La fila aprovada {index} té camps obligatoris buits.")



def render_genweb_accordion(rows: list[dict[str, str]]) -> tuple[str, int]:
    groups: "OrderedDict[str, list[dict[str, str]]]" = OrderedDict()
    for row in rows:
        topic = _clean_text(row.get("Tema"))
        subtopic = _clean_text(row.get("Subtopic"))
        group_label = subtopic or topic or "General"
        groups.setdefault(group_label, []).append(row)

    html_parts = ['<div class="upc-faq-export" data-upc-faq-export="true">']

    for group_index, (group_name, items) in enumerate(groups.items(), start=1):
        group_slug = _slugify(f"group-{group_index}-{group_name}")
        html_parts.append(f'<section class="faq-group" data-group="{html.escape(group_slug)}">')
        html_parts.append(f"<h3>{html.escape(group_name)}</h3>")
        html_parts.append(f'<div class="faq-accordion" id="{html.escape(group_slug)}">')

        for item_index, item in enumerate(items, start=1):
            panel_id = f"{group_slug}-item-{item_index}"
            question = _clean_text(item.get("Pregunta"))
            answer_html = _answer_to_html(_clean_text(item.get("Resposta")))
            source = _clean_text(item.get("Font"))

            html_parts.append('<article class="faq-item">')
            html_parts.append(
                "<button "
                f'class="faq-trigger" type="button" data-target="{html.escape(panel_id)}" '
                'aria-expanded="false">'
                f"<span>{html.escape(question)}</span>"
                '<span class="faq-icon" aria-hidden="true">+</span>'
                "</button>"
            )
            html_parts.append(f'<div class="faq-panel" id="{html.escape(panel_id)}" hidden>')
            html_parts.append(f'<div class="faq-answer">{answer_html}</div>')
            if source:
                html_parts.append(
                    f'<p class="faq-source"><a href="{html.escape(source)}" target="_blank" '
                    f'rel="noreferrer">Font original</a></p>'
                )
            html_parts.append("</div>")
            html_parts.append("</article>")

        html_parts.append("</div>")
        html_parts.append("</section>")

    html_parts.append("</div>")
    html_parts.append(
        """<script>
(function () {
  const root = document.querySelector('[data-upc-faq-export="true"]');
  if (!root) return;
  root.querySelectorAll('.faq-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const panel = targetId ? root.querySelector('#' + CSS.escape(targetId)) : null;
      if (!panel) return;
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      const icon = button.querySelector('.faq-icon');
      if (icon) icon.textContent = isOpen ? '+' : '−';
      panel.hidden = isOpen;
    });
  });
})();
</script>"""
    )

    return _prettify_export_html("\n".join(html_parts)), len(groups)


def render_upc_faqaccordion(items: list[dict[str, str]]) -> str:
    html_text, _groups = render_genweb_accordion([normalize_row_dict(item) for item in items])
    return html_text


def _prettify_export_html(text: str) -> str:
    raw = _clean_text(text)
    if not raw:
        return ""
    try:
        return BeautifulSoup(raw, "html.parser").prettify()
    except Exception:
        return raw


def approved_rows_to_html(approved_rows: list[list[Any]], log=None) -> tuple[str, int]:
    def _log(message: str) -> None:
        if log:
            log(message)

    records = apply_default_subtopics(approved_rows_to_records(approved_rows))
    _log(f"Generant HTML per {len(records)} FAQs aprovades.")
    validate_subtopics(records, require_for_approved=False)
    return render_genweb_accordion(records)


def export_text(output_path: str, text: str) -> None:
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(text)
