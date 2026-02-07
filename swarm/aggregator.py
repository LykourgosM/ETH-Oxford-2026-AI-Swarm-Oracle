from __future__ import annotations

import math

from swarm.schemas import Ballot, ConvergenceSnapshot, Vote


def compute_distribution(ballots: list[Ballot]) -> tuple[float, float, float]:
    """Return (p_yes, p_no, p_null) from a list of ballots."""
    if not ballots:
        return (0.0, 0.0, 0.0)
    total = len(ballots)
    yes = sum(1 for b in ballots if b.vote == Vote.YES)
    no = sum(1 for b in ballots if b.vote == Vote.NO)
    null = sum(1 for b in ballots if b.vote == Vote.NULL)
    return (yes / total, no / total, null / total)


def wilson_confidence_interval(p: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score 95% CI for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    denominator = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denominator
    margin = z * math.sqrt((p * (1 - p) + z**2 / (4 * n)) / n) / denominator
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def compute_entropy(p_yes: float, p_no: float, p_null: float) -> float:
    """Shannon entropy of the verdict distribution (bits)."""
    entropy = 0.0
    for p in (p_yes, p_no, p_null):
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy


def convergence_snapshot(iteration: int, ballots: list[Ballot]) -> ConvergenceSnapshot:
    """Create a convergence snapshot from all ballots so far."""
    p_yes, p_no, p_null = compute_distribution(ballots)
    return ConvergenceSnapshot(
        iteration=iteration,
        p_yes=round(p_yes, 4),
        p_no=round(p_no, 4),
        p_null=round(p_null, 4),
    )
