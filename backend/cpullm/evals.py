"""A small built-in task eval: multiple choice, scored by log-likelihood.

This is the same scoring method lm-evaluation-harness uses for tasks like
ARC and HellaSwag: the model "answers" with the choice it assigns the
highest total log-probability as a continuation of the question. It is
small enough to run on every candidate in a sweep, so you see task accuracy
move alongside speed. For publishable numbers, run lm-eval-harness on the
final recipe as well.
"""
from __future__ import annotations

import torch

# (context, choices, index of correct choice)
ITEMS = [
    ("The capital of France is", [" Paris", " Berlin", " Madrid", " Rome"], 0),
    ("The capital of Japan is", [" Tokyo", " Beijing", " Seoul", " Bangkok"], 0),
    ("Water freezes at a temperature of zero degrees", [" Celsius", " Kelvin", " Newtons", " Joules"], 0),
    ("The largest planet in our solar system is", [" Jupiter", " Mars", " Venus", " Mercury"], 0),
    ("A week has seven", [" days", " hours", " months", " years"], 0),
    ("The opposite of hot is", [" cold", " loud", " fast", " tall"], 0),
    ("Bees make", [" honey", " milk", " silk", " wool"], 0),
    ("The sun rises in the", [" east", " west", " north", " south"], 0),
    ("A baby cat is called a", [" kitten", " puppy", " calf", " foal"], 0),
    ("Two plus two equals", [" four", " five", " three", " six"], 0),
    ("The chemical symbol for water is", [" H2O", " CO2", " NaCl", " O3"], 0),
    ("Humans breathe in oxygen and breathe out carbon", [" dioxide", " monoxide", " fiber", " paper"], 0),
    ("The color of a clear daytime sky is", [" blue", " green", " purple", " brown"], 0),
    ("A triangle has three", [" sides", " wheels", " legs", " faces"], 0),
    ("The planet we live on is called", [" Earth", " Saturn", " Pluto", " Neptune"], 0),
    ("Ice is the solid form of", [" water", " air", " fire", " sand"], 0),
    ("The month after January is", [" February", " March", " December", " June"], 0),
    ("A doctor works in a", [" hospital", " bakery", " garage", " library"], 0),
    ("Fish live in", [" water", " trees", " deserts", " clouds"], 0),
    ("The CPU is the central processing", [" unit", " table", " river", " song"], 0),
    ("Computer memory that loses its contents when power is off is called", [" volatile", " permanent", " magnetic", " optical"], 0),
    ("One kilobyte is approximately one thousand", [" bytes", " meters", " seconds", " grams"], 0),
    ("The opposite of up is", [" down", " left", " over", " near"], 0),
    ("Snow is usually", [" white", " red", " black", " orange"], 0),
    ("A spider has eight", [" legs", " wings", " eyes", " tails"], 0),
    ("The primary language spoken in Brazil is", [" Portuguese", " Spanish", " French", " German"], 0),
    ("The fastest land animal is the", [" cheetah", " turtle", " snail", " cow"], 0),
    ("Plants make food from sunlight through", [" photosynthesis", " digestion", " combustion", " erosion"], 0),
    ("The number of minutes in an hour is", [" sixty", " ten", " hundred", " twelve"], 0),
    ("To read in the dark you turn on a", [" light", " stove", " fan", " tap"], 0),
]


@torch.inference_mode()
def _choice_logprob(model, tokenizer, context: str, choice: str, device) -> float:
    ctx = tokenizer.encode(context)
    full = tokenizer.encode(context + choice)
    # Tokenizers may merge across the boundary; score the tokens after the shared prefix.
    n_ctx = next((i for i, (a, b) in enumerate(zip(ctx, full)) if a != b), min(len(ctx), len(full) - 1))
    ids = torch.tensor([full], device=device)
    logp = torch.log_softmax(model(input_ids=ids).logits[0].float(), dim=-1)
    return sum(logp[i - 1, full[i]].item() for i in range(max(n_ctx, 1), len(full)))


def run(model, tokenizer) -> dict:
    from .bench import model_device

    device = model_device(model)
    correct = 0
    for context, choices, answer in ITEMS:
        scores = [_choice_logprob(model, tokenizer, context, c, device) for c in choices]
        correct += int(max(range(len(choices)), key=scores.__getitem__) == answer)
    return {"name": "cpullm-mc30", "items": len(ITEMS), "accuracy": round(correct / len(ITEMS), 4)}
