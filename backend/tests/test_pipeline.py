"""End-to-end tests on the built-in tiny model (no downloads needed)."""
import base64
import io
import json
import zipfile

import torch

from cpullm import agent, bench, models, recipe, reproduce, transforms, tuner
from cpullm.telemetry import TelemetrySampler


def _tiny():
    model, tok, _ = models.load(models.BUILTIN_TINY)
    return model, tok


def test_prune_layers_keeps_generation_working():
    model, tok = _tiny()
    model = transforms.apply(model, [{"op": "prune_layers", "drop": [5, 6]}])
    assert transforms.num_layers(model) == 6
    assert model.config.num_hidden_layers == 6
    tokens, _, steps = bench.greedy_generate(model, torch.tensor([tok.encode("hello")]), 5)
    assert len(tokens) == 5 and len(steps) == 4


def test_int8_shrinks_model():
    model, _ = _tiny()
    before = bench.model_bytes(model)
    after = bench.model_bytes(transforms.apply(model, transforms.precision_transforms("int8_dynamic")))
    assert after < before / 2


def test_tune_produces_reproducible_recipe(tmp_path):
    req = tuner.TuneRequest(precisions=["fp32", "int8_dynamic"], prune_counts=[0, 2],
                            thread_counts=[1], new_tokens=8, repeats=1, max_ppl_increase_pct=1000)
    result = tuner.tune(req)
    assert len(result["results"]) == 4
    assert all("error" not in r for r in result["results"])
    rec = result["recipe"]
    assert rec["schema"] == recipe.SCHEMA

    path = tmp_path / "recipe.json"
    path.write_text(json.dumps(rec))
    out = reproduce.main([str(path), "--new-tokens", "8", "--repeats", "1"])
    assert out["same_hardware"]
    # Same transforms on the same weights give the same model size.
    assert out["measured"]["model_bytes"] == rec["expected"]["model_bytes"]


class FakeClient:
    """Stands in for the Node server: hands out one job, records uploads."""

    def __init__(self, job):
        self.job, self.calls = job, []

    def call(self, method, path, body=None, timeout=30):
        self.calls.append((method, path, body))
        if path == "/register":
            return {"agent_id": "a1"}
        if path.endswith("/next-job"):
            job, self.job = self.job, None
            return job
        return {"ok": True}


def test_agent_runs_job_and_uploads_bundle():
    params = {"model_id": "builtin:tiny-llama", "precisions": ["fp32"], "prune_counts": [0], "thread_counts": [1],
              "new_tokens": 4, "repeats": 1, "max_ppl_increase_pct": 10, "unknown_field": 1}
    client = FakeClient({"id": "j1", "params": params})
    a = agent.Agent(client, "test")
    a.register()
    assert a.poll_once() is True
    assert a.poll_once() is False
    complete = [b for m, p, b in client.calls if p.endswith("/complete")][0]
    assert "error" not in complete
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(complete["bundle_b64"])))
    assert {"recipe.json", "report.md", "results.json", "REPRODUCE.md"} <= set(z.namelist())
    assert any(p.endswith("/events") for _, p, _ in client.calls)


def test_agent_refuses_local_paths():
    client = FakeClient({"id": "j2", "params": {"model_id": "../../etc"}})
    a = agent.Agent(client, "test")
    a.register()
    a.poll_once()
    complete = [b for m, p, b in client.calls if p.endswith("/complete")][0]
    assert "Refusing model_id" in complete["error"]


def test_telemetry_sample_has_all_channels():
    s = TelemetrySampler().sample()
    assert {"cpu_percent", "cpu_per_core", "mem_used_gb", "disk_read_mbs", "net_recv_mbs"} <= s.keys()


def test_v2_measurements_on_tiny_model():
    from cpullm import energy, evals, opprofile

    model, tok = _tiny()
    rows = bench.batch_scaling(model, tok, threads=1, batch_sizes=[1, 4], new_tokens=4)
    assert [r["batch"] for r in rows] == [1, 4]
    assert rows[1]["aggregate_tps"] > 0

    prof = opprofile.decode_profile(model, tok, steps=2)
    assert abs(sum(c["pct"] for c in prof["categories"]) - 100) < 1
    assert any(c["category"] == "matmul" for c in prof["categories"])

    ev = evals.run(model, tok)
    assert ev["items"] == len(evals.ITEMS) and 0 <= ev["accuracy"] <= 1

    with energy.EnergyMeter() as m:
        pass
    assert m.joules is None or m.joules >= 0


def test_weight_only_int8_shrinks_and_keeps_generating():
    model, tok = _tiny()
    before = bench.model_bytes(model)
    q = transforms.apply(model, transforms.precision_transforms("int8_weight_only"))
    assert bench.model_bytes(q) < before / 3  # bf16 cast (2x) then int8 weights (2x)
    tokens, _, _ = bench.greedy_generate(q, torch.tensor([tok.encode("hi")]), 3)
    assert len(tokens) == 3


def test_full_v2_tune_has_profile_batch_and_eval():
    req = tuner.TuneRequest(precisions=["fp32", "bf16"], prune_counts=[0], thread_counts=[1], new_tokens=4,
                            repeats=1, batch_sizes=[1, 2], max_ppl_increase_pct=1000, max_eval_drop_pts=100)
    result = tuner.tune(req)
    assert "op_profile" in result and "batch_scaling" in result
    assert result["baseline"]["eval"]["items"] == len(__import__("cpullm.evals").evals.ITEMS)
    assert "Where decode time goes" in __import__("cpullm.report").report.markdown(result)
    assert result["recipe"]["runtime"]["device"] == "cpu"
