import html
import re
import unicodedata

from bs4 import BeautifulSoup


def _normalize_text(value: str) -> str:
    txt = (value or "").strip().lower()
    if not txt:
        return ""
    txt = unicodedata.normalize("NFKD", txt)
    txt = "".join(ch for ch in txt if not unicodedata.combining(ch))
    return txt


def _get_row_value_case_insensitive(row: dict[str, str], wanted_key: str) -> str:
    wanted = _normalize_text(wanted_key)
    aliases = {wanted}
    if wanted == _normalize_text("Subtopic"):
        aliases.update(
            {
                _normalize_text("Sub topic"),
                _normalize_text("Subtema"),
                _normalize_text("Sub tema"),
                _normalize_text("Subtòpic"),
                _normalize_text("Sub tòpic"),
            }
        )
    for k, v in row.items():
        if _normalize_text(k) in aliases:
            return v or ""
    return ""


def _normalize_subtopic(value: str) -> str:
    text = (value or "").strip()
    if text in {"-", "--", "–", "—"}:
        return ""
    return text


def filter_approved(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    approved_values = {
        "aprovat",
        "aprovada",
        "aprovat/da",
        "aprobat",
        "approved",
        "ok",
        "si",
        "yes",
        "true",
        "1",
    }
    out = []
    for r in rows:
        estat = _normalize_text(_get_row_value_case_insensitive(r, "estat"))
        if estat in approved_values:
            out.append(r)
    return out


def _looks_like_html(text: str) -> bool:
    t = (text or "").strip()
    return "<" in t and ">" in t


def _answer_to_html_paragraph(answer: str) -> str:
    a = (answer or "").strip()
    if _looks_like_html(a):
        return a

    a = html.escape(a)
    a = a.replace("\r\n", "\n").replace("\r", "\n")
    a = a.replace("\n\n", "<br /><br />")
    a = a.replace("\n", "<br />")
    return a


def render_upc_faqaccordion(items: list[dict[str, str]]) -> str:
    def _grouped_by_topic(rows: list[dict[str, str]]) -> list[tuple[str, list[dict[str, str]]]]:
        order: list[str] = []
        grouped: dict[str, list[dict[str, str]]] = {}
        for row in rows:
            subtopic = _normalize_subtopic(_get_row_value_case_insensitive(row, "Subtopic"))
            topic = _get_row_value_case_insensitive(row, "Tema").strip()
            parent = subtopic or topic or "Preguntes frequents"
            if parent not in grouped:
                grouped[parent] = []
                order.append(parent)
            grouped[parent].append(row)
        return [(t, grouped[t]) for t in order]

    def _slug(text: str) -> str:
        base = re.sub(r"\s+", "-", (text or "").strip().lower())
        base = re.sub(r"[^a-z0-9-]", "", base)
        base = re.sub(r"-{2,}", "-", base).strip("-")
        return base or "topic"

    def _append_question_items(
        out_lines: list[str], topic_idx: int, topic_items: list[dict[str, str]], parent_id: str
    ):
        for item_idx, it in enumerate(topic_items, start=1):
            q = (it.get("Pregunta") or "").strip()
            a = (it.get("Resposta") or "").strip()
            q_html = q if _looks_like_html(q) else html.escape(q)
            a_html = _answer_to_html_paragraph(a)
            qid = f"c{topic_idx}-{item_idx}"

            out_lines.append(f"<!-- ITEM {topic_idx}.{item_idx} -->")
            out_lines.append(
                '<div class="accordion-item" style="border: 0; box-shadow: none; background: transparent; border-radius: 0;">'
            )
            out_lines.append(
                '<h2 style="padding: 0; margin: 0;">'
                f'<button type="button" class="accordion-button collapsed" data-bs-toggle="collapse" data-bs-target="#{qid}" aria-expanded="false" aria-controls="{qid}" data-upc-faq-toggle="1" '
                'style="width: 100%; text-align: left; font-size: 18px; background: transparent; padding: 30px 36px 30px 34px; '
                'font-weight: 500; color: #00769d; position: relative; border: 0; border-top: 1px solid #D1D1D1; '
                'box-shadow: none; cursor: pointer;">'
                f"{q_html}"
                "</button></h2>"
            )
            out_lines.append(
                f'<div id="{qid}" class="collapse" data-bs-parent="#{parent_id}" '
                'style="margin-bottom: -1px; position: relative; z-index: 1; height: 0px; overflow: hidden; transition: height 350ms ease;">'
            )
            out_lines.append('<div style="border-top: 0; padding: 0 18px 18px; background: transparent;">')
            out_lines.append(
                '<div style="margin: 0; font-size: 16px; font-weight: 300; padding: 0px 0px 0px 16px; line-height: 1.45; color: #636363;">'
                f"{a_html}</div>"
            )
            out_lines.append("</div></div></div>")

    topic_blocks = _grouped_by_topic(items)
    has_real_subtopic = any(
        _normalize_subtopic(_get_row_value_case_insensitive(row, "Subtopic"))
        for row in items
    )

    out: list[str] = []

    if not has_real_subtopic and len(topic_blocks) == 1:
        out.append('<div id="faqTopicAccordion" class="accordion" style="margin-bottom: 40px;">')
        out.append('<div class="accordion-body" style="border-top: 0; padding: 0 0 12px; background: transparent;">')
        out.append('<div id="faqAccordion-1" class="accordion" data-upc-faq-accordion="1">')
        _append_question_items(out, 1, topic_blocks[0][1], "faqAccordion-1")
        out.append("</div>")
        out.append("</div>")
        out.append("</div>")
    else:
        out.append('<div id="faqTopicAccordion" class="accordion" style="margin-bottom: 40px;">')

        for topic_idx, (topic, topic_items) in enumerate(topic_blocks, start=1):
            topic_id = f"topic-{topic_idx}-{_slug(topic)}"
            inner_acc_id = f"faqAccordion-{topic_idx}"

            out.append(f"<!-- TOPIC {topic_idx}: {html.escape(topic)} -->")
            out.append('<div class="accordion-item" style="border: 0; box-shadow: none; background: transparent; border-radius: 0;">')
            out.append(
                '<h2 style="padding: 0; margin: 0;">'
                f'<button type="button" class="accordion-button collapsed" data-bs-toggle="collapse" data-bs-target="#{topic_id}" aria-expanded="false" aria-controls="{topic_id}" data-upc-faq-toggle="1" '
                'style="width: 100%; text-align: left; font-size: 24px; background: transparent; padding: 30px 36px 30px 18px; '
                'font-weight: 500; color: #4A4A4A; letter-spacing: .2px; position: relative; border: 0; border-top: 1px solid #D1D1D1; '
                'box-shadow: none; cursor: pointer;">'
                f"{html.escape(topic)}"
                "</button></h2>"
            )
            out.append(
                f'<div id="{topic_id}" class="collapse" data-bs-parent="#faqTopicAccordion" '
                'style="margin-bottom: -1px; position: relative; z-index: 1; height: 0px; overflow: hidden; transition: height 350ms ease;">'
            )
            out.append('<div style="border-top: 0; padding: 0 0 12px; background: transparent;">')
            out.append(f'<div id="{inner_acc_id}" class="accordion" data-upc-faq-accordion="1">')
            _append_question_items(out, topic_idx, topic_items, inner_acc_id)
            out.append("</div>")
            out.append("</div></div>")

        out.append("</div>")
    out.append("<p>")
    out.append("<style>")
    out.append(
        """[data-upc-faq-toggle="1"]:focus { box-shadow: none !important; }
[data-upc-faq-toggle="1"]::after {
  content: "";
  position: absolute;
  right: 18px;
  top: 50%;
  width: 14px;
  height: 14px;
  border-right: 3px solid #00769d;
  border-bottom: 3px solid #00769d;
  background-image: none !important;
  transform-origin: center;
  transition: transform .25s ease !important;
  transform: translateY(-65%) rotate(45deg) !important;
}
[data-upc-faq-toggle="1"][aria-expanded="true"]::after {
  transform: translateY(-65%) rotate(225deg) !important;
}
[data-upc-faq-toggle="1"][aria-expanded="false"]::after {
  transform: translateY(-65%) rotate(45deg) !important;
}"""
    )
    out.append("</style>")
    out.append("<script>")
    out.append(
        """(function () {
  if (window.__upcFaqStandaloneInit) return;
  window.__upcFaqStandaloneInit = true;

  function initAccordion(acc) {
    if (!acc || acc.dataset.upcFaqInit === '1') return;
    acc.dataset.upcFaqInit = '1';

    var collapses = Array.from(acc.querySelectorAll(':scope > .collapse, :scope > .accordion-item > .collapse'));
    if (!collapses.length) {
      collapses = Array.from(acc.querySelectorAll('.collapse')).filter(function (col) {
        return col.getAttribute('data-bs-parent') === '#' + acc.id;
      });
    }

    function btnFor(col) {
      return acc.querySelector('[data-bs-target="#' + col.id + '"]');
    }

    function setStyles(col, isOpen) {
      var btn = btnFor(col);
        if (btn) {
        btn.style.borderTopColor = isOpen ? '#00769D' : '#D1D1D1';
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        btn.classList.toggle('collapsed', !isOpen);
      }
      col.style.borderBottomColor = isOpen ? '#00769D' : '#D1D1D1';
    }

    function open(col) {
      if (col.dataset.anim === '1') return;

      collapses.forEach(function (other) {
        if (other !== col) close(other);
      });

      col.dataset.anim = '1';
      col.classList.add('showing');
      col.style.height = '0px';

      requestAnimationFrame(function () {
        col.style.height = col.scrollHeight + 'px';
        setStyles(col, true);
      });

      var done = function (e) {
        if (e.propertyName !== 'height') return;
        col.classList.remove('showing');
        col.classList.add('show');
        col.style.height = 'auto';
        col.dataset.anim = '0';
        col.removeEventListener('transitionend', done);
      };
      col.addEventListener('transitionend', done);
    }

    function close(col) {
      if (col.dataset.anim === '1') return;
      if (!col.classList.contains('show') && col.style.height === '0px') return;

      col.dataset.anim = '1';
      col.classList.remove('show');

      col.style.height = col.scrollHeight + 'px';

      requestAnimationFrame(function () {
        col.style.height = '0px';
        setStyles(col, false);
      });

      var done = function (e) {
        if (e.propertyName !== 'height') return;
        col.dataset.anim = '0';
        col.removeEventListener('transitionend', done);
      };
      col.addEventListener('transitionend', done);
    }

    acc.querySelectorAll('button[data-bs-target]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var sel = btn.getAttribute('data-bs-target');
        var col = sel ? document.querySelector(sel) : null;
        if (!col) return;

        var isOpen = col.classList.contains('show') || col.style.height === 'auto';
        if (isOpen) close(col);
        else open(col);
      });
    });

    collapses.forEach(function (col) {
      col.style.overflow = 'hidden';
      col.style.transition = 'height 350ms ease';
      col.style.height = '0px';
      col.classList.remove('show');
      setStyles(col, false);
    });
  }

  document.querySelectorAll('#faqTopicAccordion, [id^="faqAccordion-"]').forEach(initAccordion);
})();"""
    )
    out.append("</script>")
    out.append("</p>")

    return _prettify_export_html("\n".join(out))


def _prettify_export_html(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    try:
        return BeautifulSoup(raw, "html.parser").prettify()
    except Exception:
        return raw


def export_text(output_path: str, text: str):
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(text)


def approved_rows_to_html(approved_rows, log=None):
    def _log(m):
        if log:
            log(m)

    _log(f"Generant HTML per {len(approved_rows)} FAQs aprovades (UI)...")

    items = []
    for row in approved_rows:
        topic = row[0] if len(row) > 0 else ""
        subtopic = row[1] if len(row) > 1 else ""
        question = row[2] if len(row) > 2 else ""
        answer = row[3] if len(row) > 3 else ""
        source = row[4] if len(row) > 4 else ""
        items.append(
            {
                "Tema": topic,
                "Subtopic": subtopic,
                "Pregunta": question,
                "Resposta": answer,
                "Font": source,
            }
        )

    return render_upc_faqaccordion(items)
