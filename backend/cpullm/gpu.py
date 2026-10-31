"""GPU helpers shared by hardware, telemetry and the power optimiser.

Everything here goes through `nvidia-smi`, so it works whether or not the
installed PyTorch can see the GPU (the CPU build of torch cannot). ROCm hosts
expose the same facts through `rocm-smi`; that path is listed in docs/GPU.md
as not wired yet, and every function returns an empty answer there.
"""
from __future__ import annotations

import shutil
import subprocess
import threading
import time

import os


def _find_smi() -> str | None:
    """nvidia-smi on the PATH, or where drivers put it when the PATH is reduced
    (services, sudo; WSL 2 keeps it in /usr/lib/wsl/lib)."""
    p = shutil.which("nvidia-smi")
    if p:
        return p
    for cand in ("/usr/lib/wsl/lib/nvidia-smi", "/usr/bin/nvidia-smi", r"C:\Windows\System32\nvidia-smi.exe"):
        if os.path.exists(cand):
            return cand
    return None


_SMI = _find_smi()
QUERY_TIMEOUT_S = 3.0

INVENTORY_FIELDS = ["index", "name", "memory.total", "driver_version", "power.limit", "power.max_limit", "power.min_limit", "power.default_limit"]
SAMPLE_FIELDS = ["index", "name", "utilization.gpu", "memory.used", "memory.total", "power.draw", "temperature.gpu", "clocks.sm"]


def available() -> bool:
    return _SMI is not None


def parse_csv(text: str, fields: list[str]) -> list[dict]:
    """Parse `nvidia-smi --format=csv,noheader,nounits` output into dicts.

    Values that are not numbers ("[N/A]", "[Not Supported]") become None;
    numeric strings become floats (ints where the field is a count).
    """
    rows = []
    for line in text.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < len(fields):
            continue
        row = {}
        for key, raw in zip(fields, parts):
            if key in ("name", "driver_version"):
                row[key] = raw
                continue
            try:
                val = float(raw)
            except ValueError:
                val = None
            if val is not None and key == "index":
                val = int(val)
            row[key] = val
        rows.append(row)
    return rows


def query(fields: list[str]) -> list[dict]:
    if not _SMI:
        return []
    try:
        out = subprocess.run([_SMI, f"--query-gpu={','.join(fields)}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=QUERY_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    return parse_csv(out.stdout, fields)


def inventory() -> list[dict]:
    """GPUs as the driver sees them: name, memory, driver, power limits (W)."""
    out = []
    for r in query(INVENTORY_FIELDS):
        out.append({
            "index": r["index"], "name": r["name"], "memory_gb": round((r["memory.total"] or 0) / 1024, 2),
            "driver": r["driver_version"], "power_limit_w": r["power.limit"], "power_max_limit_w": r["power.max_limit"],
            "power_min_limit_w": r["power.min_limit"], "power_default_limit_w": r["power.default_limit"],
        })
    return out


def sample() -> dict | None:
    """One utilisation sample across all GPUs, or None without a driver."""
    rows = query(SAMPLE_FIELDS)
    if not rows:
        return None
    gpus = [{"index": r["index"], "name": r["name"], "util_percent": r["utilization.gpu"],
             "mem_used_gb": round((r["memory.used"] or 0) / 1024, 3), "mem_total_gb": round((r["memory.total"] or 0) / 1024, 2),
             "power_w": r["power.draw"], "temp_c": r["temperature.gpu"], "sm_mhz": r["clocks.sm"]} for r in rows]
    util = [g["util_percent"] for g in gpus if g["util_percent"] is not None]
    power = [g["power_w"] for g in gpus if g["power_w"] is not None]
    return {
        "gpu_percent": round(sum(util) / len(util), 1) if util else None,
        "gpu_mem_used_gb": round(sum(g["mem_used_gb"] for g in gpus), 3),
        "gpu_mem_total_gb": round(sum(g["mem_total_gb"] for g in gpus), 2),
        "gpu_power_w": round(sum(power), 1) if power else None,
        "gpu_temp_c": max((g["temp_c"] for g in gpus if g["temp_c"] is not None), default=None),
        "gpus": gpus,
    }


def set_power_limit(index: int, watts: float) -> bool:
    """Set the board power limit (needs root/administrator; not supported on WSL 2)."""
    if not _SMI:
        return False
    try:
        out = subprocess.run([_SMI, "-i", str(index), "-pl", str(int(watts))], capture_output=True, text=True, timeout=QUERY_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.returncode == 0 and "not supported" not in out.stdout.lower() and "not supported" not in out.stderr.lower()


class PowerMeter:
    """Average board power (W) while a block runs, sampled from nvidia-smi."""

    def __init__(self, index: int = 0, period_s: float = 0.2) -> None:
        self.index, self.period_s = index, period_s
        self.samples: list[float] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "PowerMeter":
        self.samples, self._stop = [], threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.is_set():
            rows = query(["index", "power.draw"])
            for r in rows:
                if r["index"] == self.index and r["power.draw"] is not None:
                    self.samples.append(r["power.draw"])
            time.sleep(self.period_s)

    @property
    def watts(self) -> float | None:
        return round(sum(self.samples) / len(self.samples), 1) if self.samples else None
