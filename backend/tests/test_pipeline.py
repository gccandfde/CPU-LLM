"""End-to-end tests on the built-in tiny model (no downloads needed)."""
import io
import json
import time
import zipfile

import torch
from fastapi.testclient import TestClient

from cpullm import bench, models, recipe, reproduce, transforms, tuner
from cpullm.api import app


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


def test_api_tune_job_and_bundle():
    client = TestClient(app)
    assert client.get("/api/hardware").json()["logical_cores"] >= 1
    job_id = client.post("/api/tune", json={"precisions": ["fp32"], "prune_counts": [0], "thread_counts": [1],
                                            "new_tokens": 4, "repeats": 1}).json()["id"]
    for _ in range(300):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            break
        time.sleep(0.1)
    assert job["status"] == "done", job
    assert "CPU-LLM tuning report" in client.get(f"/api/jobs/{job_id}/report.md").text
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/jobs/{job_id}/bundle.zip").content))
    assert {"recipe.json", "report.md", "results.json", "REPRODUCE.md"} <= set(z.namelist())


def test_telemetry_websocket():
    with TestClient(app).websocket_connect("/api/telemetry") as ws:
        sample = ws.receive_json()
    assert {"cpu_percent", "mem_used_gb", "disk_read_mbs", "net_recv_mbs"} <= sample.keys()
