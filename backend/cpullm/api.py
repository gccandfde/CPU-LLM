"""HTTP + WebSocket API consumed by the React dashboard.

    uvicorn cpullm.api:app --port 8000
"""
from __future__ import annotations

import asyncio
import os
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from . import hardware, models, report, roofline, tuner
from .telemetry import TelemetrySampler

app = FastAPI(title="CPU-LLM tuning API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CPULLM_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: dict[str, dict] = {}
# Benchmarks running side by side would measure each other, so run one at a time.
_run_lock = threading.Lock()


class TuneBody(BaseModel):
    model_id: str = models.BUILTIN_TINY
    revision: str | None = None
    precisions: list[str] = Field(default_factory=lambda: ["fp32", "bf16", "int8_dynamic"])
    prune_counts: list[int] = Field(default_factory=lambda: [0, 2])
    thread_counts: list[int] | None = None
    new_tokens: int = Field(32, ge=2, le=256)
    repeats: int = Field(3, ge=1, le=10)
    max_ppl_increase_pct: float = 10.0


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/hardware")
def get_hardware() -> dict:
    hw = hardware.profile()
    return {**hw, "native_precisions": hardware.native_precisions(hw)}


@app.get("/api/platforms")
def get_platforms() -> list[dict]:
    return roofline.REFERENCE_PLATFORMS


@app.post("/api/tune")
def start_tune(body: TuneBody) -> dict:
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(409, "A tuning job is already running")
    job_id = uuid.uuid4().hex[:8]
    job = {"id": job_id, "status": "running", "created": time.time(), "events": [], "results": [],
           "progress": 0.0, "message": "Queued", "result": None, "error": None}
    JOBS[job_id] = job

    def on_progress(e: dict) -> None:
        job["events"].append({**e, "ts": time.time()})
        job["message"] = e.get("message", job["message"])
        if e["stage"] == "candidate":
            job["progress"] = e["index"] / e["total"]
        elif e["stage"] == "result":
            job["results"].append(e["result"])

    def work() -> None:
        try:
            job["result"] = tuner.tune(tuner.TuneRequest(**body.model_dump()), on_progress)
            job.update(status="done", progress=1.0, message="Done")
        except Exception as e:
            job.update(status="error", error=f"{type(e).__name__}: {e}", message="Failed")
        finally:
            _run_lock.release()

    threading.Thread(target=work, daemon=True).start()
    return {"id": job_id}


def _job(job_id: str) -> dict:
    if job_id not in JOBS:
        raise HTTPException(404, "No such job")
    return JOBS[job_id]


def _done(job_id: str) -> dict:
    job = _job(job_id)
    if job["status"] != "done":
        raise HTTPException(409, f"Job is {job['status']}")
    return job["result"]


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    return [{k: j[k] for k in ("id", "status", "created", "message")} for j in JOBS.values()]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    return {k: v for k, v in _job(job_id).items() if k != "events"}


@app.get("/api/jobs/{job_id}/report.md", response_class=PlainTextResponse)
def get_report(job_id: str) -> str:
    return report.markdown(_done(job_id))


@app.get("/api/jobs/{job_id}/bundle.zip")
def get_bundle(job_id: str) -> Response:
    return Response(report.bundle(_done(job_id)), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="cpullm-tuning-{job_id}.zip"'})


@app.websocket("/api/telemetry")
async def telemetry(ws: WebSocket) -> None:
    await ws.accept()
    sampler = TelemetrySampler()
    try:
        while True:
            await asyncio.sleep(1.0)
            await ws.send_json(sampler.sample())
    except (WebSocketDisconnect, RuntimeError):
        pass
