"""Benchmark suite and power optimiser smoke tests (tiny sizes, CPU only)."""
from cpullm import power, suite


def test_suite_runs_every_kernel_on_cpu():
    events = []
    r = suite.run({"stream_mb": 16, "gemm_sizes": [256], "attention_ctx": [256], "gather_mb": 16, "repeats": 1}, events.append)
    assert r["kind"] == "benchmark" and r["device"] == "cpu"
    assert set(r["kernels"]) == {"stream", "gemm", "attention", "gather"}
    assert r["kernels"]["stream"]["triad_gbs"] > 0
    assert r["kernels"]["gemm"][0]["tflops"] > 0
    assert r["kernels"]["attention"][0]["decode_tokens_s"] > 0
    assert r["peak"]["bandwidth_gbs"] > 0
    assert [e["stage"] for e in events].count("result") == 4


def test_power_optimiser_sweeps_cores_and_restores_affinity():
    before = power.current_affinity()
    r = power.optimize({"model_id": "builtin:tiny-llama", "precision": "fp32", "core_counts": [1, 2], "new_tokens": 4, "repeats": 1, "idle_w": 10, "tdp_w": 60})
    assert r["kind"] == "power" and [p["cores"] for p in r["points"]] == [1, 2]
    for p in r["points"]:
        assert p["decode_tps"] > 0 and p["watts"] > 0 and p["tokens_per_joule"] > 0
    assert r["energy_source"] in ("rapl", "estimated")
    assert set(r["recommendation"]) == {"performance", "balanced", "efficiency"}
    assert power.current_affinity() == before


def test_estimated_power_is_linear_in_active_cores():
    assert power.estimate_watts(0, 16, 10, 60) == 10
    assert power.estimate_watts(16, 16, 10, 60) == 60
    assert power.estimate_watts(8, 16, 10, 60) == 35
