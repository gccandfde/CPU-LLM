"""Live system telemetry: CPU, memory, disk and network, sampled as rates."""
from __future__ import annotations

import time

import psutil


class TelemetrySampler:
    """Each call to sample() returns usage since the previous call."""

    def __init__(self) -> None:
        self._last_t = time.monotonic()
        self._last_disk = psutil.disk_io_counters()
        self._last_net = psutil.net_io_counters()
        psutil.cpu_percent(percpu=True)  # prime the counters

    def sample(self) -> dict:
        now = time.monotonic()
        dt = max(now - self._last_t, 1e-6)
        disk, net = psutil.disk_io_counters(), psutil.net_io_counters()
        per_core = psutil.cpu_percent(percpu=True)
        mem = psutil.virtual_memory()
        out = {
            "ts": time.time(),
            "cpu_percent": round(sum(per_core) / len(per_core), 1) if per_core else 0.0,
            "cpu_per_core": per_core,
            "mem_used_gb": round(mem.used / 1e9, 3),
            "mem_percent": mem.percent,
            "disk_read_mbs": _rate(self._last_disk, disk, "read_bytes", dt),
            "disk_write_mbs": _rate(self._last_disk, disk, "write_bytes", dt),
            "net_recv_mbs": _rate(self._last_net, net, "bytes_recv", dt),
            "net_sent_mbs": _rate(self._last_net, net, "bytes_sent", dt),
        }
        self._last_t, self._last_disk, self._last_net = now, disk, net
        return out


def _rate(prev, cur, field: str, dt: float) -> float:
    if prev is None or cur is None:
        return 0.0
    return round((getattr(cur, field) - getattr(prev, field)) / dt / 1e6, 3)
