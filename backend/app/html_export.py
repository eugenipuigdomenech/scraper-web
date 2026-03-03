import html
from typing import Dict, List
from bs4 import BeautifulSoup


def filter_approved(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    approved_values = {"aprobat", "aprovada", "approved"}
    out = []
    for r in rows:
        estat = (r.get("Estat") or r.get("estat") or "").strip().lower()
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


def render_upc_faqaccordion(items: List[Dict[str, str]]) -> str:
    out: List[str] = []
    out.append('<div id="faqAccordion" style="margin-bottom: 40px;">')

    for idx, it in enumerate(items, start=1):
        q = (it.get("Pregunta") or "").strip()
        a = (it.get("Resposta") or "").strip()

        q_html = q if _looks_like_html(q) else html.escape(q)
        a_html = _answer_to_html_paragraph(a)

        out.append(f"<!-- ITEM {idx} -->")
        out.append('<div style="border: 0; box-shadow: none; border-bottom: 1px solid #D1D1D1; background: transparent;">')
        out.append(
            '<h2 style="padding: 0; margin: 0;">'
            f'<button type="button" data-bs-toggle="collapse" data-bs-target="#c{idx}" aria-expanded="false" aria-controls="c{idx}" '
            'style="width: 100%; text-align: left; font-size: 18px; background: transparent; padding: 30px 36px 30px 18px; '
            'font-weight: 500; color: #00769d; position: relative; border: 0; border-top: 1px solid #D1D1D1; '
            'box-shadow: none; cursor: pointer;">'
            f"{q_html} "
            '<span aria-hidden="true" style="position: absolute; right: 18px; top: 50%; transform: translateY(-50%); '
            'font-size: 22px; line-height: 1; color: #00769D; transition: all .25s ease;">&#8964;</span> '
            "</button></h2>"
        )
        out.append(
            f'<div id="c{idx}" class="collapse" data-bs-parent="#faqAccordion" '
            'style="border-bottom: 1px solid #D1D1D1; margin-bottom: -1px; position: relative; z-index: 1; height: 0px; overflow: hidden; '
            'transition: height 350ms ease;">'
        )
        out.append('<div style="border-top: 0; padding: 0 18px 18px;">')
        out.append(
            '<div style="margin: 0; font-size: 16px; font-weight: 300; line-height: 1.45; color: #636363;">'
            f"{a_html}</div>"
        )
        out.append("</div></div></div>")

    out.append("</div>")
    out.append("<p>")
    out.append("<script>")
    out.append(
        r"""(function () {
  const acc = document.getElementById('faqAccordion');
  if (!acc) return;

  const collapses = Array.from(acc.querySelectorAll('.collapse'));

  function btnFor(col) {
    return acc.querySelector('[data-bs-target="#' + col.id + '"]');
  }

  function setStyles(col, isOpen) {
    const btn = btnFor(col);
    if (btn) {
      btn.style.borderTopColor = isOpen ? '#00769D' : '#D1D1D1';
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      const icon = btn.querySelector('span[aria-hidden="true"]');
      if (icon) {
        icon.textContent = isOpen ? '\u2303' : '\u2304';
        icon.style.transform = 'translateY(-50%)';
      }
    }
    col.style.borderBottomColor = isOpen ? '#00769D' : '#D1D1D1';
  }

  function open(col) {
    if (col.dataset.anim === '1') return;

    collapses.forEach(other => { if (other !== col) close(other); });

    col.dataset.anim = '1';
    col.classList.add('showing');
    col.style.height = '0px';

    requestAnimationFrame(() => {
      const h = col.scrollHeight;
      col.style.height = h + 'px';
      setStyles(col, true);
    });

    const done = (e) => {
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

    const h = col.scrollHeight;
    col.style.height = h + 'px';

    requestAnimationFrame(() => {
      col.style.height = '0px';
      setStyles(col, false);
    });

    const done = (e) => {
      if (e.propertyName !== 'height') return;
      col.dataset.anim = '0';
      col.removeEventListener('transitionend', done);
    };
    col.addEventListener('transitionend', done);
  }

  acc.querySelectorAll('button[data-bs-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const sel = btn.getAttribute('data-bs-target');
      const col = sel ? document.querySelector(sel) : null;
      if (!col) return;

      const isOpen = col.classList.contains('show') || col.style.height === 'auto';
      if (isOpen) close(col);
      else open(col);
    });
  });

  collapses.forEach(col => {
    col.style.overflow = 'hidden';
    col.style.transition = 'height 350ms ease';
    col.style.height = '0px';
    col.classList.remove('show');
    setStyles(col, false);
  });
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
        topic, question, answer, source = row
        items.append(
            {
                "Tema": topic,
                "Pregunta": question,
                "Resposta": answer,
                "Font": source,
            }
        )

    return render_upc_faqaccordion(items)
