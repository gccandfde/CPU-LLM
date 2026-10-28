"""CPU package energy from the Linux powercap (RAPL) interface.

Both Intel and AMD (Zen, via the same `intel-rapl` powercap driver) expose
cumulative package energy counters in microjoules. Reading them usually needs
root or a relaxed permission on energy_uj. Inside most VMs they don't exist;
then every reading is None and reports show "n/a".
"""
from __future__ import annotations

import glob
import time


def _packages() -> list[tuple[str, int]]:
    out = []
    for d in glob.glob("/sys/class/powercap/intel-rapl:[0-9]*"):
        if d.count(":") != 1:  # skip sub-domains (core, uncore, dram)
            continue
        try:
            with open(f"{d}/max_energy_range_uj") as f:
                out.append((f"{d}/energy_uj", int(f.read())))
        except OSError:
            continue
    return out


def _read(path: str) -> int | None:
    try:
        with open(path) as f:
            return int(f.read())
    except (OSError, ValueError):
        return None


class EnergyMeter:
    """Context manager: `with EnergyMeter() as m: ...` then m.joules / m.watts."""

    def __init__(self) -> None:
        self.packages = _packages()
        self.joules: float | None = None
        self.watts: float | None = None

    def __enter__(self):
        self._start = [_read(p) for p, _ in self.packages]
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *exc) -> None:
        elapsed = time.perf_counter() - self._t0
        end = [_read(p) for p, _ in self.packages]
        if not self.packages or None in self._start or None in end:
            return
        total = 0
        for (_, wrap), a, b in zip(self.packages, self._start, end):
            total += b - a if b >= a else b + wrap - a  # counter wrapped
        self.joules = round(total / 1e6, 3)
        self.watts = round(self.joules / elapsed, 2) if elapsed > 0 else None


def available() -> bool:
    return any(_read(p) is not None for p, _ in _packages())
