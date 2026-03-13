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


def _now_local() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


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

    def _make_item_id(self, topic: str, subtopic: str, question: str, source: str) -> str:
        raw = f"{topic}|{subtopic}|{question}|{source}".encode("utf-8")
        return hashlib.sha1(raw).hexdigest()[:12]

    def _rows_to_review_items(self, rows: list[list[Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in rows:
            topic = str(row[0]).strip() if len(row) > 0 else ""
            subtopic = str(row[1]).strip() if len(row) > 1 else ""
            question = str(row[2]).strip() if len(row) > 2 else ""
            answer = str(row[3]).strip() if len(row) > 3 else ""
            status = str(row[4]).strip() if len(row) > 4 else "Pendent"
            created_at = str(row[5]).strip() if len(row) > 5 else _now_local()
            updated_at = str(row[6]).strip() if len(row) > 6 else created_at
            last_modified_by = str(row[7]).strip() if len(row) > 7 else "Agent IA"
            annual_update = str(row[8]).strip() if len(row) > 8 else "-"
            source = str(row[9]).strip() if len(row) > 9 else ""
            approved = status.lower() in {"aprovat", "aprovada", "approved"}

            out.append(
                {
                    "id": self._make_item_id(topic, subtopic, question, source),
                    "topic": topic,
                    "subtopic": subtopic,
                    "question": question,
                    "answer": answer,
                    "source": source,
                    "status": "Aprovat" if approved else "Pendent",
                    "approved": approved,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "last_modified_by": last_modified_by,
                    "annual_update": annual_update,
                }
            )
        return out

    def _review_items_to_rows(self, items: list[dict[str, Any]]) -> list[list[str]]:
        rows: list[list[str]] = []
        for item in items:
            rows.append(
                [
                    item.get("topic", ""),
                    item.get("subtopic", ""),
                    item.get("question", ""),
                    item.get("answer", ""),
                    "Aprovat" if bool(item.get("approved")) else "Pendent",
                    item.get("created_at") or _now_local(),
                    item.get("updated_at") or _now_local(),
                    item.get("last_modified_by") or "Review UI",
                    item.get("annual_update") or "-",
                    item.get("source", ""),
                ]
            )
        return rows

    def _get_or_build_items(self, job: dict[str, Any]) -> list[dict[str, Any]]:
        items = job.get("review_items")
        if items is None:
            items = self._rows_to_review_items((job.get("result") or {}).get("rows") or [])
            job["review_items"] = items
        return items

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
            items = self._get_or_build_items(job)
            return copy.deepcopy(items)

    def update_review_item(self, job_id: str, item_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = self._get_or_build_items(job)
            for item in items:
                if item.get("id") != item_id:
                    continue

                if "approved" in changes and changes["approved"] is not None:
                    item["approved"] = bool(changes["approved"])
                    item["status"] = "Aprovat" if item["approved"] else "Pendent"

                for field in ("topic", "subtopic", "question", "answer", "source", "annual_update", "last_modified_by"):
                    if field in changes and changes[field] is not None:
                        item[field] = str(changes[field]).strip()

                item["updated_at"] = _now_local()
                if not item.get("last_modified_by"):
                    item["last_modified_by"] = "Review UI"
                job["updated_at"] = _now_iso()
                return copy.deepcopy(item)
            return None

    def bulk_set_review_items(self, job_id: str, item_ids: list[str], approved: bool) -> int | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = self._get_or_build_items(job)
            targets = set(item_ids)
            updated = 0
            for item in items:
                if item.get("id") not in targets:
                    continue
                item["approved"] = approved
                item["status"] = "Aprovat" if approved else "Pendent"
                item["updated_at"] = _now_local()
                item["last_modified_by"] = item.get("last_modified_by") or "Review UI"
                updated += 1

            if updated:
                job["updated_at"] = _now_iso()
            return updated

    def set_all_review_items(self, job_id: str, approved: bool) -> int | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = self._get_or_build_items(job)
            for item in items:
                item["approved"] = approved
                item["status"] = "Aprovat" if approved else "Pendent"
                item["updated_at"] = _now_local()
                item["last_modified_by"] = item.get("last_modified_by") or "Review UI"
            job["updated_at"] = _now_iso()
            return len(items)

    def get_review_rows(self, job_id: str, only_approved: bool = False) -> list[list[str]] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None

            items = self._get_or_build_items(job)
            filtered_items = items if not only_approved else [it for it in items if bool(it.get("approved"))]
            return self._review_items_to_rows(filtered_items)

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs = [copy.deepcopy(j) for j in self._jobs.values()]
        jobs.sort(key=lambda j: j["created_at"], reverse=True)
        return jobs


job_manager = JobManager()
