from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from swarm.aggregator import (
    compute_distribution,
    compute_entropy,
    convergence_snapshot,
    wilson_confidence_interval,
)
from swarm.archetypes import ALL_ARCHETYPES, Archetype
from swarm.config import COMMITTEE_SIZE, NUM_ITERATIONS
from swarm.evaluator import evaluate
from swarm.models import LLMProvider, get_available_providers
from swarm.sampler import sample_committee
from swarm.schemas import Ballot, EvidenceBundle, ConvergenceSnapshot, VerdictDistribution

logger = logging.getLogger(__name__)


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

    for i in range(1, num_iterations + 1):
        committee = sample_committee(archetypes, providers, committee_size)

        # Run all agents in this committee in parallel
        tasks = [
            evaluate(arch, provider, bundle, iteration=i)
            for arch, provider in committee
        ]
        results = await asyncio.gather(*tasks)

        # Collect successful ballots
        for ballot in results:
            if ballot is not None:
                all_ballots.append(ballot)

        snapshot = convergence_snapshot(i, all_ballots)
        convergence.append(snapshot)
        logger.info(
            "Iteration %d/%d — P(YES)=%.3f P(NO)=%.3f P(NULL)=%.3f (%d total ballots)",
            i, num_iterations, snapshot.p_yes, snapshot.p_no, snapshot.p_null, len(all_ballots),
        )

    # Final aggregation
    p_yes, p_no, p_null = compute_distribution(all_ballots)
    ci = wilson_confidence_interval(p_yes, len(all_ballots))
    entropy = compute_entropy(p_yes, p_no, p_null)

    return VerdictDistribution(
        question=bundle.question,
        p_yes=round(p_yes, 4),
        p_no=round(p_no, 4),
        p_null=round(p_null, 4),
        num_iterations=num_iterations,
        committee_size=committee_size,
        confidence_interval_95=(round(ci[0], 4), round(ci[1], 4)),
        entropy=round(entropy, 4),
        ballots=all_ballots,
        convergence=convergence,
    )


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

    p_yes, p_no, p_null = compute_distribution(all_ballots)
    ci = wilson_confidence_interval(p_yes, len(all_ballots))
    entropy = compute_entropy(p_yes, p_no, p_null)

    yield VerdictDistribution(
        question=bundle.question,
        p_yes=round(p_yes, 4),
        p_no=round(p_no, 4),
        p_null=round(p_null, 4),
        num_iterations=num_iterations,
        committee_size=committee_size,
        confidence_interval_95=(round(ci[0], 4), round(ci[1], 4)),
        entropy=round(entropy, 4),
        ballots=all_ballots,
        convergence=convergence,
    )
