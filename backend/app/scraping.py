from datetime import datetime
import re
from typing import Any, Dict, List, Tuple

import requests
from bs4 import BeautifulSoup


def scrape_faqs(url: str, log=None, debug: bool = False) -> List[Tuple[str, str]]:
    def _log(m: str):
        if log:
            log(m)

    r = requests.get(
        url,
        timeout=25,
        allow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "ca,en;q=0.8,es;q=0.7",
        },
    )

    if debug:
        _log(f"DEBUG status: {r.status_code} | final_url: {r.url} | bytes: {len(r.text)}")

    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    faqs: List[Tuple[str, str]] = []

    def _normalize_question(q: str) -> str:
        text = (q or "").strip()
        # Treu prefixos de numeració tipus "1. ", "2) ", "10 - "
        text = re.sub(r"^\s*\d+\s*(?:[.)]|[-–—])\s*", "", text)
        return text.strip()

    def _inner_html(tag) -> str:
        return "".join(str(c) for c in getattr(tag, "contents", [])).strip()

    # Format 0: FAQs numerades dins .accordion-body
    # Ex.: "1) Pregunta..." seguit de paràgrafs/llistes de resposta fins la següent "N)"
    def _parse_numbered_faq_block(block) -> List[Tuple[str, str]]:
        numbered: List[Tuple[str, str]] = []
        current_q = ""
        current_a_html: List[str] = []
        first_num = None

        for node in block.children:
            if not getattr(node, "name", None):
                continue

            txt = node.get_text(" ", strip=True)
            if not txt:
                continue

            m = re.match(r"^\s*(\d+)\)\s*(.*)$", txt)
            is_question_node = bool(m and node.name == "p")

            if is_question_node:
                num = int(m.group(1))
                if first_num is None:
                    first_num = num

                if current_q and current_a_html:
                    numbered.append((current_q, "".join(current_a_html).strip()))

                rest = m.group(2).strip()
                current_q = _normalize_question(rest)
                current_a_html = []

                # Cas puntual: pregunta i resposta al mateix <p> separades per "?"
                if "?" in rest:
                    q_part, a_part = rest.split("?", 1)
                    current_q = q_part.strip() + "?"
                    inline_answer = a_part.strip()
                    if inline_answer:
                        current_a_html.append(f"<p>{inline_answer}</p>")
                continue

            if current_q:
                current_a_html.append(str(node))

        if current_q and current_a_html:
            numbered.append((current_q, "".join(current_a_html).strip()))

        if first_num != 1:
            return []

        return numbered

    numbered_blocks: List[List[Tuple[str, str]]] = []
    for body in soup.select(".accordion-body"):
        parsed = _parse_numbered_faq_block(body)
        if not parsed:
            continue
        numbered_blocks.append(parsed)

    if numbered_blocks:
        merged: List[Tuple[str, str]] = []
        for block in numbered_blocks:
            merged.extend(block)
        return merged

    # Format 1: UPC antic
    q_tags = soup.select('#collapse-base a[data-toggle="collapse"][href^="#collapse-"]')
    if q_tags:
        for q in q_tags:
            question = q.get_text(" ", strip=True)
            question = _normalize_question(question)
            target_id = q.get("href", "").lstrip("#")
            collapse_div = soup.find(id=target_id)
            if not collapse_div:
                continue
            body = collapse_div.select_one(".panel-body") or collapse_div
            answer = body.get_text(" ", strip=True)
            if question and answer:
                faqs.append((question, answer))
        if faqs:
            return faqs

    # Format 3: #faqAccordion
    root = soup.select_one("#faqAccordion")
    if root:
        btns = root.select('button[data-bs-toggle="collapse"][data-bs-target^="#"]')
        if debug:
            _log(f"DEBUG #faqAccordion buttons: {len(btns)}")

        for btn in btns:
            btn_copy = BeautifulSoup(str(btn), "html.parser").select_one("button")
            if btn_copy:
                for s in btn_copy.select("span"):
                    s.decompose()
                question = btn_copy.get_text(" ", strip=True)
            else:
                question = btn.get_text(" ", strip=True)
            question = _normalize_question(question)

            target = (btn.get("data-bs-target") or "").strip()
            if not target.startswith("#"):
                continue

            panel = root.select_one(target) or soup.select_one(target)
            if not panel:
                continue

            ps = panel.select("p")
            if ps:
                answer = " ".join(p.get_text(" ", strip=True) for p in ps if p.get_text(strip=True))
            else:
                answer = panel.get_text(" ", strip=True)

            if question and answer:
                faqs.append((question, answer))

        if faqs:
            return faqs

    # Format 2: Bootstrap 5 accordion
    items = soup.select(".accordion-item")
    if debug:
        _log(f"DEBUG accordion-item: {len(items)}")

    seen_pairs = set()

    for item in items:
        q_btn = item.select_one("button.accordion-button")
        a_body = item.select_one(".accordion-body")
        if not a_body:
            continue

        # Subformat: FAQs dins de <li> amb <strong>Pregunta</strong> i resposta a sota
        li_items = a_body.select("li")
        li_faqs = []
        for li in li_items:
            strong = li.find("strong")
            if not strong:
                continue

            q = _normalize_question(strong.get_text(" ", strip=True))
            if not q:
                continue

            li_copy = BeautifulSoup(str(li), "html.parser").find("li")
            if not li_copy:
                continue

            strong_copy = li_copy.find("strong")
            if strong_copy:
                strong_copy.decompose()

            answer_html = _inner_html(li_copy).strip()
            if not answer_html:
                continue

            key = (q, answer_html)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            li_faqs.append((q, answer_html))

        if li_faqs:
            faqs.extend(li_faqs)
            continue

        # Subformat normal: una pregunta al botó i una resposta al body
        q = q_btn.get_text(" ", strip=True) if q_btn else ""
        q = _normalize_question(q)
        a = _inner_html(a_body)
        if q and a:
            key = (q, a)
            if key not in seen_pairs:
                seen_pairs.add(key)
                faqs.append((q, a))

    if faqs:
        return faqs

    # Format 4: Genweb GW4
    gw4 = soup.select("div.accordion.accordion-gw4")
    if debug:
        _log(f"DEBUG accordion-gw4 blocks: {len(gw4)}")

    if gw4:
        for block in gw4:
            items = block.select(":scope > div")
            if not items:
                items = block.select("div")

            for it in items:
                q_a = it.select_one('a[id^="open-accordion"]')
                content = it.select_one("div.accordion-content")
                if not q_a or not content:
                    continue

                question = q_a.get_text(" ", strip=True)
                question = _normalize_question(question)
                answer = content.get_text(" ", strip=True)
                if question and answer:
                    faqs.append((question, answer))

        if faqs:
            return faqs

    # Mètode extra: buttons data-bs-target
    btns = soup.select('button.accordion-button[data-bs-target]')
    if debug:
        _log(f"DEBUG buttons with data-bs-target: {len(btns)}")

    for btn in btns:
        q = btn.get_text(" ", strip=True)
        q = _normalize_question(q)
        target = (btn.get("data-bs-target") or "").strip()
        if not target.startswith("#"):
            continue
        panel = soup.select_one(target)
        if not panel:
            continue
        body = panel.select_one(".accordion-body") or panel
        a = body.get_text(" ", strip=True)
        if q and a:
            faqs.append((q, a))

    return faqs


def build_outputs(
    sources: List[Tuple[str, str]], log=None, debug: bool = False, progress_cb=None
) -> Tuple[List[List[str]], List[Dict[str, Any]], Dict[str, int], List[Dict[str, str]]]:
    def _log(m: str):
        if log:
            log(m)

    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    estat_default = "Pendent"
    persona_default = "Agent IA"
    anual_default = "-"

    out_rows: List[List[str]] = []
    genweb_blocks: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []

    total_faqs = 0
    ok_urls = 0

    for i, (url, topic) in enumerate(sources, start=1):
        _log(f"\n[{i}/{len(sources)}] Processing URL: {url}")
        _log(f"    Topic: {topic}")

        try:
            faqs = scrape_faqs(url, log=log, debug=debug)
            _log(f"    FAQs found: {len(faqs)}")
            ok_urls += 1

            for pregunta, resposta in faqs:
                out_rows.append(
                    [
                        topic,
                        "",
                        pregunta.strip(),
                        resposta.strip(),
                        estat_default,
                        now_ts,
                        now_ts,
                        persona_default,
                        anual_default,
                        url,
                    ]
                )

            genweb_blocks.append(
                {
                    "topic": topic,
                    "source_url": url,
                    "items": [{"q": q.strip(), "a": a.strip()} for (q, a) in faqs],
                }
            )

            total_faqs += len(faqs)

        except Exception as e:
            err = str(e)
            errors.append({"url": url, "topic": topic, "error": err})
            _log(f"⚠️ Error processing URL: {url}")
            _log(f"    → {err}")
            genweb_blocks.append({"topic": topic, "source_url": url, "items": []})
        finally:
            if progress_cb:
                try:
                    progress_cb(i, len(sources), url)
                except Exception:
                    pass

    stats = {
        "total_urls": len(sources),
        "ok_urls": ok_urls,
        "total_errors": len(errors),
        "total_rows": len(out_rows),
        "total_faqs": total_faqs,
        "total_json_blocks": len(genweb_blocks),
    }
    return out_rows, genweb_blocks, stats, errors
