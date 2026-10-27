"""Model loading. Supports Hugging Face causal LMs and a built-in tiny model.

The built-in model ("builtin:tiny-llama") is randomly initialised from a fixed
seed and needs no download, so tests and offline demos work anywhere. Its
accuracy numbers are meaningless; its speed numbers are real.
"""
from __future__ import annotations

import torch

BUILTIN_TINY = "builtin:tiny-llama"


class ByteTokenizer:
    """Minimal tokenizer for the built-in model: one token per UTF-8 byte."""

    vocab_size = 256

    def encode(self, text: str) -> list[int]:
        return list(text.encode("utf-8"))

    def decode(self, ids: list[int]) -> str:
        return bytes(i % 256 for i in ids).decode("utf-8", errors="replace")


class HFTokenizer:
    def __init__(self, tok) -> None:
        self._tok = tok

    def encode(self, text: str) -> list[int]:
        return self._tok(text, add_special_tokens=False)["input_ids"]

    def decode(self, ids: list[int]) -> str:
        return self._tok.decode(ids, skip_special_tokens=True)


def load(model_id: str, revision: str | None = None):
    """Return (model, tokenizer, resolved_revision) with the model in fp32 eval mode."""
    if model_id == BUILTIN_TINY:
        from transformers import LlamaConfig, LlamaForCausalLM

        torch.manual_seed(0)
        cfg = LlamaConfig(vocab_size=256, hidden_size=256, intermediate_size=688,
                          num_hidden_layers=8, num_attention_heads=8, num_key_value_heads=4,
                          max_position_embeddings=1024)
        return LlamaForCausalLM(cfg).eval(), ByteTokenizer(), "seed-0"

    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_id, revision=revision)
    model = AutoModelForCausalLM.from_pretrained(model_id, revision=revision, dtype=torch.float32)
    return model.eval(), HFTokenizer(tok), _resolve_revision(model_id, revision)


def _resolve_revision(model_id: str, revision: str | None) -> str | None:
    """Pin the exact commit so a recipe always rebuilds from identical weights."""
    try:
        from huggingface_hub import HfApi

        return HfApi().model_info(model_id, revision=revision).sha
    except Exception:  # offline or local path
        return revision
