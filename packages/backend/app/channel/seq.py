"""seq-epoch policy — a transport concern shared by the adapter and the hub.

`seq` is monotonic per session. Each session "epoch" (a launch, a resume, or a dead-channel's
synthetic tail) claims a fresh `SEQ_BLOCK`-sized band above the previous one, so a client holding a
prior-epoch `Last-Event-ID` never mistakes new events for already-seen ones. One number per epoch is
persisted (`provider_state["seq_base"]`); gaps between bands are harmless for dedup and ordering.

Home here (delivery layer), NOT in the adapter — so the provider-agnostic hub does not pull a
constant out of a concrete provider (review П1/П2). The claude-code adapter re-exports it.
"""

from __future__ import annotations

# Large enough that a single epoch never overruns its band; small enough that many epochs stay under
# JS Number.MAX_SAFE_INTEGER (2^53) for the TS frontend.
SEQ_BLOCK = 1_000_000_000


def next_epoch_base(current_base: int) -> int:
    """The base of the next seq epoch above `current_base`."""
    return current_base + SEQ_BLOCK
