"""Benchmark one model configuration: speed, memory, and accuracy proxies.

Speed is split the way it behaves on hardware:
  * prefill (time-to-first-token) is compute-bound: matrix-matrix work,
  * decode (tokens/s after the first) is memory-bandwidth-bound at batch 1:
    every generated token streams all the weights through the memory system.
"""
from __future__ import annotations

import io
import math
import os
import statistics
import time

import psutil
import torch

EVAL_TEXT = (
    "The central processing unit executes instructions fetched from memory. Modern processors "
    "use deep pipelines, out-of-order execution and wide vector units to keep many operations in "
    "flight. Caches hide the latency of main memory, but large neural networks do not fit in cache, "
    "so their speed is often limited by how fast weights can be streamed from DRAM. A graphics "
    "processor trades latency for throughput: thousands of simple cores share very high bandwidth "
    "memory. Choosing the right numeric precision, removing redundant layers and placing threads "
    "close to the memory they use can change inference speed by large factors."
)
PROMPT = "Explain why memory bandwidth matters for running language models on a CPU."


def model_bytes(model: torch.nn.Module) -> int:
    """Serialised size of all weights, including packed quantised params."""
    buf = io.BytesIO()
    torch.save(model.state_dict(), buf)
    return buf.tell()


@torch.inference_mode()
def greedy_generate(model, input_ids: torch.Tensor, new_tokens: int) -> tuple[list[int], float, list[float]]:
    """Manual KV-cached greedy decode. Returns (tokens, prefill_s, per-token decode times)."""
    t0 = time.perf_counter()
    out = model(input_ids=input_ids, use_cache=True)
    nxt = out.logits[:, -1, :].argmax(-1, keepdim=True)
    prefill = time.perf_counter() - t0
    tokens, step_times, past = [int(nxt)], [], out.past_key_values
    for _ in range(new_tokens - 1):
        t = time.perf_counter()
        out = model(input_ids=nxt, past_key_values=past, use_cache=True)
        past = out.past_key_values
        nxt = out.logits[:, -1, :].argmax(-1, keepdim=True)
        step_times.append(time.perf_counter() - t)
        tokens.append(int(nxt))
    return tokens, prefill, step_times


@torch.inference_mode()
def perplexity(model, tokenizer, text: str = EVAL_TEXT) -> float:
    ids = torch.tensor([tokenizer.encode(text)])
    logits = model(input_ids=ids).logits.float()
    loss = torch.nn.functional.cross_entropy(logits[0, :-1], ids[0, 1:])
    return round(math.exp(loss.item()), 4)


def run(model, tokenizer, threads: int, new_tokens: int = 32, repeats: int = 3,
        reference_tokens: list[int] | None = None) -> dict:
    torch.set_num_threads(threads)
    ids = torch.tensor([tokenizer.encode(PROMPT)])
    # Warm-up at full length: thread-pool start, kernel selection, page-in.
    # Skipping this makes whichever config runs first look several times slower.
    greedy_generate(model, ids, new_tokens)

    prefills, decode_tps, tokens = [], [], []
    for _ in range(repeats):
        tokens, prefill, steps = greedy_generate(model, ids, new_tokens)
        prefills.append(prefill)
        if steps:
            decode_tps.append(len(steps) / sum(steps))

    agreement = None
    if reference_tokens:
        n = min(len(reference_tokens), len(tokens))
        agreement = round(sum(a == b for a, b in zip(reference_tokens[:n], tokens[:n])) / n, 4)

    return {
        "threads": threads,
        "prompt_tokens": ids.shape[1],
        "new_tokens": new_tokens,
        "ttft_ms": round(statistics.median(prefills) * 1000, 2),
        "decode_tps": round(statistics.median(decode_tps), 2) if decode_tps else None,
        "decode_ms_per_token": round(1000 / statistics.median(decode_tps), 2) if decode_tps else None,
        "perplexity": perplexity(model, tokenizer),
        "token_agreement": agreement,
        "tokens": tokens,
        "sample_text": tokenizer.decode(tokens),
        "model_bytes": model_bytes(model),
        "rss_gb": round(psutil.Process(os.getpid()).memory_info().rss / 1e9, 3),
    }
