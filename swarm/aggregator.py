from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from swarm.schemas import Ballot, ConvergenceSnapshot, Vote


# ── #1: Dirichlet-Multinomial Posterior ─────────────────────────────

def compute_vote_counts(ballots: list[Ballot]) -> tuple[float, float, float]:
    """Count votes for each outcome (unweighted)."""
    alpha_yes = sum(1 for b in ballots if b.vote == Vote.YES)
    alpha_no = sum(1 for b in ballots if b.vote == Vote.NO)
    alpha_null = sum(1 for b in ballots if b.vote == Vote.NULL)
    return float(alpha_yes), float(alpha_no), float(alpha_null)


def dirichlet_posterior(
    ballots: list[Ballot],
    num_samples: int = 10_000,
) -> tuple[tuple[float, float, float], dict[str, tuple[float, float]]]:
    """Compute Dirichlet posterior mean and 95% credible intervals.

    Returns:
        (posterior_mean, credible_intervals)
        posterior_mean: (p_yes, p_no, p_null)
        credible_intervals: {"YES": (lo, hi), "NO": (lo, hi), "NULL": (lo, hi)}
    """
    alpha_yes, alpha_no, alpha_null = compute_vote_counts(ballots)

    # Dirichlet prior: uniform (1, 1, 1)
    alpha = np.array([alpha_yes + 1, alpha_no + 1, alpha_null + 1])

    # Posterior mean
    total = alpha.sum()
    posterior_mean = (alpha[0] / total, alpha[1] / total, alpha[2] / total)

    # Sample from Dirichlet to get credible intervals
    samples = np.random.dirichlet(alpha, size=num_samples)
    ci = {
        "YES": (float(np.percentile(samples[:, 0], 2.5)), float(np.percentile(samples[:, 0], 97.5))),
        "NO": (float(np.percentile(samples[:, 1], 2.5)), float(np.percentile(samples[:, 1], 97.5))),
        "NULL": (float(np.percentile(samples[:, 2], 2.5)), float(np.percentile(samples[:, 2], 97.5))),
    }

    return posterior_mean, ci


# ── Legacy (kept for convergence snapshots during iteration) ────────

def compute_distribution(ballots: list[Ballot]) -> tuple[float, float, float]:
    """Return (p_yes, p_no, p_null) from a list of ballots (unweighted)."""
    if not ballots:
        return (0.0, 0.0, 0.0)
    total = len(ballots)
    yes = sum(1 for b in ballots if b.vote == Vote.YES)
    no = sum(1 for b in ballots if b.vote == Vote.NO)
    null = sum(1 for b in ballots if b.vote == Vote.NULL)
    return (yes / total, no / total, null / total)


# ── #3: KL Divergence ──────────────────────────────────────────────

def kl_divergence(
    p: tuple[float, float, float],
    q: tuple[float, float, float],
    epsilon: float = 1e-10,
) -> float:
    """KL(P || Q) for two discrete distributions over 3 outcomes."""
    return sum(
        pi * math.log2((pi + epsilon) / (qi + epsilon))
        for pi, qi in zip(p, q)
    )


# ── #4: Fleiss' Kappa ──────────────────────────────────────────────

def fleiss_kappa(ballots: list[Ballot]) -> float:
    """Compute Fleiss' kappa for inter-rater reliability.

    Groups ballots by iteration. Each iteration is a 'subject' rated by
    the committee members.
    """
    # Group ballots by iteration
    by_iter: dict[int, list[Ballot]] = defaultdict(list)
    for b in ballots:
        by_iter[b.iteration].append(b)

    if len(by_iter) < 2:
        return 0.0

    categories = [Vote.YES, Vote.NO, Vote.NULL]
    n_subjects = len(by_iter)

    # Build rating matrix: rows = iterations, cols = categories
    matrix: list[list[int]] = []
    for it in sorted(by_iter.keys()):
        row = [sum(1 for b in by_iter[it] if b.vote == cat) for cat in categories]
        matrix.append(row)

    # Number of raters per subject (may vary if some calls failed)
    ns = [sum(row) for row in matrix]

    # Filter out subjects with < 2 raters
    valid = [(row, n) for row, n in zip(matrix, ns) if n >= 2]
    if len(valid) < 2:
        return 0.0

    matrix_v = [row for row, _ in valid]
    ns_v = [n for _, n in valid]
    n_subjects_v = len(valid)

    # P_observed: mean pairwise agreement
    p_observed = 0.0
    for row, n in zip(matrix_v, ns_v):
        p_observed += (sum(r * r for r in row) - n) / (n * (n - 1))
    p_observed /= n_subjects_v

    # P_expected: chance agreement from marginal proportions
    total_ratings = sum(ns_v)
    p_expected = 0.0
    for j in range(len(categories)):
        pj = sum(row[j] for row in matrix_v) / total_ratings
        p_expected += pj * pj

    if abs(1 - p_expected) < 1e-10:
        return 1.0  # perfect agreement

    return (p_observed - p_expected) / (1 - p_expected)


# ── #6: Effective Sample Size ──────────────────────────────────────

def effective_sample_size(ballots: list[Ballot]) -> float:
    """Estimate effective sample size discounting for same-model correlation.

    Uses the design effect formula: n_eff = n / (1 + (avg_cluster - 1) * rho)
    where rho is estimated from within-cluster vote agreement.
    """
    if not ballots:
        return 0.0

    n = len(ballots)

    # Group by model
    by_model: dict[str, list[Ballot]] = defaultdict(list)
    for b in ballots:
        by_model[b.model].append(b)

    if len(by_model) >= n:
        return float(n)  # each ballot from different model, no correlation

    # Average cluster size
    avg_cluster = n / len(by_model)

    # Estimate within-model correlation (rho) from vote agreement
    # For each model group, compute proportion of most-common vote
    agreements = []
    for model_ballots in by_model.values():
        if len(model_ballots) < 2:
            continue
        votes = [b.vote for b in model_ballots]
        most_common = max(set(votes), key=votes.count)
        agreement = votes.count(most_common) / len(votes)
        agreements.append(agreement)

    if not agreements:
        return float(n)

    # rho: excess agreement above chance (baseline 1/3 for 3 categories)
    mean_agreement = sum(agreements) / len(agreements)
    rho = max(0.0, (mean_agreement - 1 / 3) / (1 - 1 / 3))

    deff = 1 + (avg_cluster - 1) * rho
    return n / deff


# ── Entropy ────────────────────────────────────────────────────────

def compute_entropy(p_yes: float, p_no: float, p_null: float) -> float:
    """Shannon entropy of the verdict distribution (bits)."""
    entropy = 0.0
    for p in (p_yes, p_no, p_null):
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy


# ── Convergence Snapshot ───────────────────────────────────────────

def convergence_snapshot(iteration: int, ballots: list[Ballot]) -> ConvergenceSnapshot:
    """Create a convergence snapshot from all ballots so far."""
    p_yes, p_no, p_null = compute_distribution(ballots)
    return ConvergenceSnapshot(
        iteration=iteration,
        p_yes=round(p_yes, 4),
        p_no=round(p_no, 4),
        p_null=round(p_null, 4),
    )
