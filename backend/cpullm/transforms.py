"""Model transforms. Each transform is a small, serialisable dict so that a
sequence of them (a recipe) can be replayed on any machine:

    {"op": "prune_layers", "drop": [5, 6]}
    {"op": "quantize_dynamic", "dtype": "qint8"}
    {"op": "cast", "dtype": "bfloat16"}

New transforms (LoRA merge, distillation student swap, MoE expert pruning, ...)
plug in by adding a function to TRANSFORMS.
"""
from __future__ import annotations

import torch
from torch import nn


def _decoder_layers(model: nn.Module) -> tuple[nn.Module, str]:
    """Find the ModuleList holding the transformer blocks."""
    for parent_path, attr in (("model", "layers"), ("transformer", "h"), ("gpt_neox", "layers")):
        parent = getattr(model, parent_path, None)
        if parent is not None and isinstance(getattr(parent, attr, None), nn.ModuleList):
            return parent, attr
    raise ValueError(f"Don't know where the decoder layers live in {type(model).__name__}")


@torch.inference_mode()
def layer_redundancy(model: nn.Module, input_ids: torch.Tensor) -> list[float]:
    """Per-block cosine similarity between its input and output hidden states.

    Close to 1.0 means the block barely changes the representation, so it is
    the cheapest to remove (Gromov et al., 2024, "The Unreasonable
    Ineffectiveness of the Deeper Layers").
    """
    hs = model(input_ids=input_ids, output_hidden_states=True).hidden_states
    return [round(torch.nn.functional.cosine_similarity(hs[i][0].float(), hs[i + 1][0].float(), dim=-1).mean().item(), 4)
            for i in range(len(hs) - 1)]


def num_layers(model: nn.Module) -> int:
    parent, attr = _decoder_layers(model)
    return len(getattr(parent, attr))


def prune_layers(model: nn.Module, drop: list[int]) -> nn.Module:
    """Remove whole transformer blocks (depth pruning)."""
    parent, attr = _decoder_layers(model)
    layers = getattr(parent, attr)
    drop_set = {i % len(layers) for i in drop}
    kept = [layer for i, layer in enumerate(layers) if i not in drop_set]
    if not kept:
        raise ValueError("Cannot drop every layer")
    # KV-cache slots are indexed by layer_idx, so renumber the survivors.
    for i, layer in enumerate(kept):
        for sub in layer.modules():
            if hasattr(sub, "layer_idx"):
                sub.layer_idx = i
    setattr(parent, attr, nn.ModuleList(kept))
    cfg = model.config
    for key in ("num_hidden_layers", "n_layer", "num_layers"):
        if hasattr(cfg, key):
            setattr(cfg, key, len(kept))
    if getattr(cfg, "layer_types", None):
        cfg.layer_types = [t for i, t in enumerate(cfg.layer_types) if i not in drop_set]
    return model


def quantize_dynamic(model: nn.Module, dtype: str = "qint8", per_channel: bool = True,
                     skip: list[str] | None = None) -> nn.Module:
    """int8 weights for nn.Linear layers, activations quantised on the fly.

    Per-channel scales and keeping the (large, outlier-sensitive) lm_head in
    float cut the accuracy loss substantially on small models.

    Uses torch.ao (deprecated upstream in favour of torchao); fine for the POC,
    the production path is torchao / oneDNN / ZenDNN int8 + int4 kernels.
    """
    from torch.ao.quantization import default_dynamic_qconfig, per_channel_dynamic_qconfig
    from torch.ao.quantization import quantize_dynamic as qd

    qconfig = per_channel_dynamic_qconfig if per_channel else default_dynamic_qconfig
    skip_set = set(skip or [])
    spec = {name: qconfig for name, mod in model.named_modules()
            if isinstance(mod, nn.Linear) and name not in skip_set}
    return qd(model, spec, dtype=getattr(torch, dtype))


def cast(model: nn.Module, dtype: str = "bfloat16") -> nn.Module:
    return model.to(getattr(torch, dtype))


TRANSFORMS = {
    "prune_layers": prune_layers,
    "quantize_dynamic": quantize_dynamic,
    "cast": cast,
}


def apply(model: nn.Module, transforms: list[dict]) -> nn.Module:
    for t in transforms:
        args = {k: v for k, v in t.items() if k != "op"}
        model = TRANSFORMS[t["op"]](model, **args)
    return model.eval()


def precision_transforms(precision: str) -> list[dict]:
    return {
        "fp32": [],
        "bf16": [{"op": "cast", "dtype": "bfloat16"}],
        "int8_dynamic": [{"op": "quantize_dynamic", "dtype": "qint8", "per_channel": True, "skip": ["lm_head"]}],
    }[precision]
