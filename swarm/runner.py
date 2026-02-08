from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from swarm.aggregator import (
    compute_distribution,
    compute_entropy,
    convergence_snapshot,
    dirichlet_posterior,
    effective_sample_size,
    fleiss_kappa,
    kl_divergence,
)
from swarm.archetypes import ALL_ARCHETYPES, Archetype
from swarm.config import COMMITTEE_SIZE, CONVERGENCE_PATIENCE, CONVERGENCE_THRESHOLD, MIN_BALLOTS_FOR_CONVERGENCE, NUM_ITERATIONS
from swarm.evaluator import evaluate
from swarm.models import LLMProvider, get_available_providers
from swarm.sampler import sample_committee
from swarm.schemas import Ballot, EvidenceBundle, ConvergenceSnapshot, VerdictDistribution

logger = logging.getLogger(__name__)


def _build_verdict(
    bundle: EvidenceBundle,
    all_ballots: list[Ballot],
    convergence: list[ConvergenceSnapshot],
    num_iterations: int,
    committee_size: int,
    converged_at: int | None,
) -> VerdictDistribution:
    """Build the final VerdictDistribution from accumulated ballots."""
    (p_yes, p_no, p_null), cis = dirichlet_posterior(all_ballots)
    entropy = compute_entropy(p_yes, p_no, p_null)
    kappa = fleiss_kappa(all_ballots)
    n_eff = effective_sample_size(all_ballots)

    return VerdictDistribution(
        question=bundle.question,
        p_yes=round(p_yes, 4),
        p_no=round(p_no, 4),
        p_null=round(p_null, 4),
        num_iterations=num_iterations,
        committee_size=committee_size,
        converged_at_iteration=converged_at,
        credible_intervals_95={k: (round(lo, 4), round(hi, 4)) for k, (lo, hi) in cis.items()},
        entropy=round(entropy, 4),
        fleiss_kappa=round(kappa, 4),
        effective_sample_size=round(n_eff, 2),
        ballots=all_ballots,
        convergence=convergence,
    )


async def run_swarm(
    bundle: EvidenceBundle,
    num_iterations: int = NUM_ITERATIONS,
    committee_size: int = COMMITTEE_SIZE,
    archetypes: list[Archetype] | None = None,
    providers: list[LLMProvider] | None = None,
) -> VerdictDistribution:
    """Run the full Monte Carlo committee sampling loop and return a verdict."""
    archetypes = archetypes or ALL_ARCHETYPES
    providers = providers or get_available_providers()

    all_ballots: list[Ballot] = []
    convergence: list[ConvergenceSnapshot] = []
    converged_at: int | None = None
    patience_count = 0

    for i in range(1, num_iterations + 1):
        committee = sample_committee(archetypes, providers, committee_size)

        # Run all agents in this committee in parallel
        tasks = [
            evaluate(arch, provider, bundle, iteration=i)
            for arch, provider in committee
        ]
        results = await asyncio.gather(*tasks)

        for ballot in results:
            if ballot is not None:
                all_ballots.append(ballot)

        snapshot = convergence_snapshot(i, all_ballots)
        convergence.append(snapshot)
        logger.info(
            "Iteration %d/%d — P(YES)=%.3f P(NO)=%.3f P(NULL)=%.3f (%d total ballots)",
            i, num_iterations, snapshot.p_yes, snapshot.p_no, snapshot.p_null, len(all_ballots),
        )

        # #3: KL divergence early stopping (only after enough ballots)
        if len(all_ballots) >= MIN_BALLOTS_FOR_CONVERGENCE and len(convergence) >= 2:
            prev = convergence[-2]
            curr = convergence[-1]
            kl = kl_divergence(
                (curr.p_yes, curr.p_no, curr.p_null),
                (prev.p_yes, prev.p_no, prev.p_null),
            )
            if kl < CONVERGENCE_THRESHOLD:
                patience_count += 1
                if patience_count >= CONVERGENCE_PATIENCE:
                    converged_at = i
                    logger.info("Converged at iteration %d (KL=%.6f)", i, kl)
                    break
            else:
                patience_count = 0

    return _build_verdict(bundle, all_ballots, convergence, num_iterations, committee_size, converged_at)


async def stream_swarm(
    bundle: EvidenceBundle,
    num_iterations: int = NUM_ITERATIONS,
    committee_size: int = COMMITTEE_SIZE,
    archetypes: list[Archetype] | None = None,
    providers: list[LLMProvider] | None = None,
) -> AsyncIterator[ConvergenceSnapshot | VerdictDistribution]:
    """Stream convergence snapshots per iteration, then yield the final verdict."""
    archetypes = archetypes or ALL_ARCHETYPES
    providers = providers or get_available_providers()

    all_ballots: list[Ballot] = []
    convergence: list[ConvergenceSnapshot] = []
    converged_at: int | None = None
    patience_count = 0

    for i in range(1, num_iterations + 1):
        committee = sample_committee(archetypes, providers, committee_size)
        tasks = [
            evaluate(arch, provider, bundle, iteration=i)
            for arch, provider in committee
        ]
        results = await asyncio.gather(*tasks)

        for ballot in results:
            if ballot is not None:
                all_ballots.append(ballot)

        snapshot = convergence_snapshot(i, all_ballots)
        convergence.append(snapshot)
        yield snapshot

        # #3: KL divergence early stopping (only after enough ballots)
        if len(all_ballots) >= MIN_BALLOTS_FOR_CONVERGENCE and len(convergence) >= 2:
            prev = convergence[-2]
            curr = convergence[-1]
            kl = kl_divergence(
                (curr.p_yes, curr.p_no, curr.p_null),
                (prev.p_yes, prev.p_no, prev.p_null),
            )
            if kl < CONVERGENCE_THRESHOLD:
                patience_count += 1
                if patience_count >= CONVERGENCE_PATIENCE:
                    converged_at = i
                    break
            else:
                patience_count = 0

    yield _build_verdict(bundle, all_ballots, convergence, num_iterations, committee_size, converged_at)
