from __future__ import annotations

import copy
import hashlib
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.scraping import build_outputs

JobStatus = str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create_scrape_job(self, sources: list[tuple[str, str]], debug: bool = False) -> dict[str, Any]:
        cleaned_sources = []
        for url, topic in sources:
            u = (url or "").strip()
            t = (topic or "").strip()
            if not u:
                continue
            cleaned_sources.append((u, t))

        if not cleaned_sources:
            raise ValueError("No valid URLs were provided.")

        job_id = uuid.uuid4().hex
        now = _now_iso()
        job = {
            "job_id": job_id,
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "total_sources": len(cleaned_sources),
            "processed_sources": 0,
            "progress_ratio": 0.0,
            "current_url": None,
            "error": None,
            "logs": [],
            "result": None,
        }

        with self._lock:
            self._jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_scrape_job,
            args=(job_id, cleaned_sources, debug),
            daemon=True,
        )
        thread.start()

        return self.get_job(job_id)

    def _append_log(self, job_id: str, message: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            logs = job["logs"]
            logs.append(message)
            if len(logs) > 800:
                del logs[: len(logs) - 800]
            job["updated_at"] = _now_iso()

    def _set_progress(self, job_id: str, done: int, total: int, current_url: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            total_safe = max(total, 1)
            job["processed_sources"] = done
            job["total_sources"] = total
            job["progress_ratio"] = done / total_safe
            job["current_url"] = current_url
            job["updated_at"] = _now_iso()

    def _set_status(self, job_id: str, status: JobStatus, error: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job["status"] = status
            job["error"] = error
            job["updated_at"] = _now_iso()

    def _set_result(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job["result"] = result
            rows = result.get("rows") or []
            job["review_items"] = self._rows_to_review_items(rows)
            job["updated_at"] = _now_iso()

    def _make_item_id(self, topic: str, question: str, source: str) -> str:
        raw = f"{topic}|{question}|{source}".encode("utf-8")
        return hashlib.sha1(raw).hexdigest()[:12]

    def _rows_to_review_items(self, rows: list[list[Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in rows:
            topic = str(row[0]).strip() if len(row) > 0 else ""
            question = str(row[1]).strip() if len(row) > 1 else ""
            answer = str(row[2]).strip() if len(row) > 2 else ""
            status = str(row[3]).strip() if len(row) > 3 else "Pendent"
            source = str(row[8]).strip() if len(row) > 8 else ""
            approved = status.lower() in {"aprovat", "aprovada", "approved"}
            out.append(
                {
                    "id": self._make_item_id(topic, question, source),
                    "topic": topic,
                    "question": question,
                    "answer": answer,
                    "source": source,
                    "status": "Aprovat" if approved else "Pendent",
                    "approved": approved,
                }
            )
        return out

    def _review_items_to_rows(self, items: list[dict[str, Any]]) -> list[list[str]]:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rows: list[list[str]] = []
        for item in items:
            rows.append(
                [
                    item.get("topic", ""),
                    item.get("question", ""),
                    item.get("answer", ""),
                    "Aprovat" if bool(item.get("approved")) else "Pendent",
                    now,
                    now,
                    "Review UI",
                    "-",
                    item.get("source", ""),
                ]
            )
        return rows

    def _run_scrape_job(self, job_id: str, sources: list[tuple[str, str]], debug: bool) -> None:
        self._set_status(job_id, "running")
        self._append_log(job_id, f"Job started with {len(sources)} URL(s)")

        def _log(message: str) -> None:
            self._append_log(job_id, message)

        def _progress(done: int, total: int, current_url: str) -> None:
            self._set_progress(job_id, done, total, current_url)

        try:
            started = time.perf_counter()
            rows, blocks, stats, errors = build_outputs(
                sources,
                log=_log,
                debug=debug,
                progress_cb=_progress,
            )
            duration_s = round(time.perf_counter() - started, 2)

            result = {
                "rows": rows,
                "blocks": blocks,
                "stats": stats,
                "errors": errors,
                "duration_s": duration_s,
            }
            self._set_result(job_id, result)
            self._set_progress(job_id, len(sources), len(sources), "")
            self._set_status(job_id, "done")
            self._append_log(job_id, f"Job completed in {duration_s}s")
        except Exception as exc:
            self._set_status(job_id, "error", str(exc))
            self._append_log(job_id, f"Job failed: {exc}")

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return copy.deepcopy(job)

    def get_review_items(self, job_id: str) -> list[dict[str, Any]] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            items = job.get("review_items")
            if items is None:
                result_rows = (job.get("result") or {}).get("rows") or []
                items = self._rows_to_review_items(result_rows)
                job["review_items"] = items
            return copy.deepcopy(items)

    def update_review_item(self, job_id: str, item_id: str, approved: bool) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = job.get("review_items")
            if items is None:
                items = self._rows_to_review_items((job.get("result") or {}).get("rows") or [])
                job["review_items"] = items

            for item in items:
                if item.get("id") != item_id:
                    continue
                item["approved"] = approved
                item["status"] = "Aprovat" if approved else "Pendent"
                job["updated_at"] = _now_iso()
                return copy.deepcopy(item)
            return None

    def bulk_set_review_items(self, job_id: str, item_ids: list[str], approved: bool) -> int | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = job.get("review_items")
            if items is None:
                items = self._rows_to_review_items((job.get("result") or {}).get("rows") or [])
                job["review_items"] = items

            targets = set(item_ids)
            updated = 0
            for item in items:
                if item.get("id") in targets:
                    item["approved"] = approved
                    item["status"] = "Aprovat" if approved else "Pendent"
                    updated += 1

            if updated:
                job["updated_at"] = _now_iso()
            return updated

    def set_all_review_items(self, job_id: str, approved: bool) -> int | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = job.get("review_items")
            if items is None:
                items = self._rows_to_review_items((job.get("result") or {}).get("rows") or [])
                job["review_items"] = items

            for item in items:
                item["approved"] = approved
                item["status"] = "Aprovat" if approved else "Pendent"
            job["updated_at"] = _now_iso()
            return len(items)

    def get_review_rows(self, job_id: str, only_approved: bool = False) -> list[list[str]] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = job.get("review_items")
            if items is None:
                items = self._rows_to_review_items((job.get("result") or {}).get("rows") or [])
                job["review_items"] = items

            filtered_items = items
            if only_approved:
                filtered_items = [it for it in items if bool(it.get("approved"))]

            return self._review_items_to_rows(filtered_items)

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = [copy.deepcopy(j) for j in self._jobs.values()]
        jobs.sort(key=lambda j: j["created_at"], reverse=True)
        return jobs


job_manager = JobManager()
