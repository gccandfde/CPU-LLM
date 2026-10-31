"""GPU helper tests that need no GPU: nvidia-smi parsing and the power dispatch."""
import torch

from cpullm import gpu, power

SMI_SAMPLE = """0, NVIDIA GeForce RTX 5050 Laptop GPU, 37, 1532, 8151, 21.50, 48, 1500
1, NVIDIA H100 80GB HBM3, [N/A], 0, 81559, [Not Supported], 31, 345
"""


def test_parse_csv_handles_numbers_and_not_available():
    rows = gpu.parse_csv(SMI_SAMPLE, gpu.SAMPLE_FIELDS)
    assert [r["index"] for r in rows] == [0, 1]
    assert rows[0]["name"] == "NVIDIA GeForce RTX 5050 Laptop GPU" and rows[0]["utilization.gpu"] == 37.0
    assert rows[1]["utilization.gpu"] is None and rows[1]["power.draw"] is None
    assert rows[1]["memory.total"] == 81559.0


def test_parse_csv_skips_short_lines():
    assert gpu.parse_csv("garbage\n\n", gpu.SAMPLE_FIELDS) == []


def test_sample_aggregates_across_gpus(monkeypatch):
    monkeypatch.setattr(gpu, "query", lambda fields: gpu.parse_csv(SMI_SAMPLE, fields))
    s = gpu.sample()
    assert s["gpu_percent"] == 37.0  # the N/A GPU is left out of the average
    assert s["gpu_mem_used_gb"] == round(1532 / 1024, 3)
    assert s["gpu_power_w"] == 21.5 and s["gpu_temp_c"] == 48
    assert len(s["gpus"]) == 2 and s["gpus"][1]["sm_mhz"] == 345.0


def test_sample_is_none_without_driver(monkeypatch):
    monkeypatch.setattr(gpu, "query", lambda fields: [])
    assert gpu.sample() is None


def test_gpu_power_optimiser_refuses_without_cuda():
    if torch.cuda.is_available():
        return  # exercised for real on GPU hosts
    try:
        power.optimize({"device": "cuda", "model_id": "builtin:tiny-llama"})
    except ValueError as e:
        assert "CUDA" in str(e) or "GPU" in str(e)
    else:
        raise AssertionError("expected a ValueError when no GPU is visible")


def test_default_power_limits_step_down_from_max():
    assert power.default_power_limits(115, 60) == [115, 98, 81, 63]
    assert power.default_power_limits(100, 90) == [100]
    assert power.default_power_limits(None, None) == []
