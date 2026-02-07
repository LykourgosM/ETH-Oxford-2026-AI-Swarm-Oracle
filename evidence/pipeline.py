"""Evidence pipeline orchestrator — question → EvidenceBundle."""
from __future__ import annotations

import logging

from swarm.schemas import EvidenceBundle, EvidenceItem

from evidence.collector import collect
from evidence.merkle import hash_evidence, merkle_root
from evidence.planner import plan
from evidence.scorer import score_quality

logger = logging.getLogger(__name__)


async def build_evidence_bundle(question: str) -> EvidenceBundle:
    """Full pipeline: question → plan → collect → score → hash → EvidenceBundle."""

    # 1. Plan — LLM generates search queries + rubric
    queries, rubric = await plan(question)

    # 2. Collect — Tavily search
    raw_evidence = await collect(queries)

    if not raw_evidence:
        raise ValueError(f"No evidence found for question: {question}")

    # 3. Score + build evidence items
    evidence = [
        EvidenceItem(
            id=i + 1,
            url=item["url"],
            snippet=item["snippet"],
            timestamp=item["timestamp"],
            quality_score=score_quality(item["url"]),
        )
        for i, item in enumerate(raw_evidence)
    ]

    # 4. Merkle hash
    hashes = [hash_evidence(e.model_dump()) for e in evidence]
    root = merkle_root(hashes)

    logger.info(
        "Built evidence bundle: %d items, merkle_root=%s",
        len(evidence),
        root[:18] + "...",
    )

    return EvidenceBundle(
        question=question,
        rubric=rubric,
        evidence=evidence,
        merkle_root=root,
    )
