"""Agent: runs on the machine being tuned and connects out to the Node server.

    python -m cpullm.agent --server https://your-site.example --token $AGENT_TOKEN

Only outbound HTTPS is needed, so it works behind NAT and firewalls. The
agent registers its hardware profile, streams telemetry every second, polls
for tuning jobs, runs them locally and uploads progress, the report and the
recipe bundle.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.request

from . import hardware, report, tuner
from .telemetry import TelemetrySampler

# Mirror of the server's check: Hub ids or built-ins only, never local paths.
MODEL_ID = re.compile(r"^(builtin:[\w-]+|[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*)$")
JOB_FIELDS = {f for f in tuner.TuneRequest.__dataclass_fields__}


class Client:
    def __init__(self, server: str, token: str) -> None:
        self.base = server.rstrip("/") + "/api/agent"
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None, timeout: float = 30):
        data = json.dumps(body, default=str).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return json.loads(raw) if raw else None


class Agent:
    def __init__(self, client: Client, name: str) -> None:
        self.client = client
        self.name = name
        self.agent_id: str | None = None
        self.stop = threading.Event()

    def register(self) -> None:
        hw = hardware.profile()
        self.agent_id = self.client.call("POST", "/register", {"name": self.name, "hardware": hw})["agent_id"]
        print(f"Registered as {self.agent_id} ({hw['model_name']}, {hw['logical_cores']} threads)", flush=True)

    def telemetry_loop(self) -> None:
        sampler = TelemetrySampler()
        while not self.stop.wait(1.0):
            try:
                self.client.call("POST", f"/{self.agent_id}/telemetry", {"samples": [sampler.sample()]}, timeout=5)
            except Exception:
                pass  # telemetry is best-effort; never let it kill the agent

    def run_job(self, job: dict) -> None:
        job_id, params = job["id"], job["params"]
        path = f"/{self.agent_id}/jobs/{job_id}"
        print(f"Job {job_id}: tuning {params.get('model_id')}", flush=True)

        def on_progress(e: dict) -> None:
            try:
                self.client.call("POST", f"{path}/events", {"events": [e]})
            except Exception as err:
                print(f"  progress upload failed: {err}", flush=True)

        try:
            if not MODEL_ID.match(str(params.get("model_id", ""))):
                raise ValueError(f"Refusing model_id {params.get('model_id')!r}")
            req = tuner.TuneRequest(**{k: v for k, v in params.items() if k in JOB_FIELDS})
            result = tuner.tune(req, on_progress)
        except Exception as e:
            self.client.call("POST", f"{path}/complete", {"error": f"{type(e).__name__}: {e}"})
            print(f"Job {job_id} failed: {e}", flush=True)
            return
        self.client.call("POST", f"{path}/complete", {
            "result": result,
            "report_md": report.markdown(result),
            "bundle_b64": base64.b64encode(report.bundle(result)).decode(),
        }, timeout=120)
        print(f"Job {job_id} done: best = {result['best']}", flush=True)

    def poll_once(self) -> bool:
        """Claim and run one job if there is one. Returns True if a job ran."""
        job = self.client.call("GET", f"/{self.agent_id}/next-job")
        if not job:
            return False
        self.run_job(job)
        return True

    def run_forever(self, poll_s: float = 2.0) -> None:
        while not self.stop.is_set():
            try:
                self.register()
                break
            except Exception as e:  # server down or bad token: keep trying, loudly
                print(f"Registration failed ({e}); retrying in 10s", flush=True)
                self.stop.wait(10)
        threading.Thread(target=self.telemetry_loop, daemon=True).start()
        while not self.stop.is_set():
            try:
                self.poll_once()
            except urllib.error.HTTPError as e:
                if e.code == 404:  # server forgot us (e.g. data wiped): register again
                    self.register()
                else:
                    print(f"Server error {e.code}; retrying", flush=True)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                print(f"Server unreachable ({e}); retrying", flush=True)
            self.stop.wait(poll_s)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="CPU-LLM tuning agent")
    ap.add_argument("--server", default=os.environ.get("CPULLM_SERVER", "http://localhost:3000"))
    ap.add_argument("--token", default=os.environ.get("CPULLM_AGENT_TOKEN"))
    ap.add_argument("--name", default=socket.gethostname())
    args = ap.parse_args(argv)
    if not args.token:
        ap.error("--token or CPULLM_AGENT_TOKEN is required")
    Agent(Client(args.server, args.token), args.name).run_forever()


if __name__ == "__main__":
    main()
