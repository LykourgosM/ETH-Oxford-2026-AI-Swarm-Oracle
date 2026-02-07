"""CLI entry point — run the swarm against a mock evidence bundle."""
from __future__ import annotations

import asyncio
import json
import logging
import sys

from swarm.config import NUM_ITERATIONS, COMMITTEE_SIZE
from swarm.mock_evidence import MOCK_BUNDLES
from swarm.runner import run_swarm


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Pick which mock bundle to run (default: 0), optionally override config
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    iterations = int(sys.argv[2]) if len(sys.argv) > 2 else NUM_ITERATIONS
    committee = int(sys.argv[3]) if len(sys.argv) > 3 else COMMITTEE_SIZE

    bundle = MOCK_BUNDLES[idx]
    print(f"\nQuestion: {bundle.question}")
    print(f"Evidence items: {len(bundle.evidence)}")
    print(f"Iterations: {iterations}, Committee size: {committee}\n")

    verdict = await run_swarm(
        bundle=bundle,
        num_iterations=iterations,
        committee_size=committee,
    )

    print("\n" + "=" * 60)
    print("VERDICT DISTRIBUTION (Dirichlet posterior)")
    print("=" * 60)
    print(f"  P(YES)  = {verdict.p_yes:.2%}")
    print(f"  P(NO)   = {verdict.p_no:.2%}")
    print(f"  P(NULL) = {verdict.p_null:.2%}")
    print(f"  95% CIs:")
    for outcome, (lo, hi) in verdict.credible_intervals_95.items():
        print(f"    {outcome}: [{lo:.2%}, {hi:.2%}]")
    print(f"  Entropy: {verdict.entropy:.3f} bits")
    print(f"  Fleiss' Kappa: {verdict.fleiss_kappa:.3f}")
    print(f"  Effective N: {verdict.effective_sample_size:.1f} / {len(verdict.ballots)} ballots")
    if verdict.converged_at_iteration:
        print(f"  Converged at iteration: {verdict.converged_at_iteration}")
    print("=" * 60)

    # Dump full result to file
    out_path = "verdict.json"
    with open(out_path, "w") as f:
        json.dump(verdict.model_dump(), f, indent=2)
    print(f"\nFull result written to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
