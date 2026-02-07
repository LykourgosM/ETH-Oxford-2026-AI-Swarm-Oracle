from __future__ import annotations

import json
import logging
import re

from swarm.archetypes import Archetype
from swarm.models import LLMProvider
from swarm.schemas import Ballot, EvidenceBundle, Vote

logger = logging.getLogger(__name__)


def _build_user_prompt(bundle: EvidenceBundle) -> str:
    evidence_block = "\n".join(
        f"[Evidence {e.id}] (quality: {e.quality_score}) {e.snippet} — source: {e.url} ({e.timestamp})"
        for e in bundle.evidence
    )
    rubric_block = ", ".join(bundle.rubric)

    return (
        f"QUESTION: {bundle.question}\n\n"
        f"EVALUATION RUBRIC: {rubric_block}\n\n"
        f"EVIDENCE BUNDLE:\n{evidence_block}\n\n"
        "Now evaluate the question using ONLY the evidence above. "
        "Respond with a single JSON object and nothing else."
    )


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from LLM output, tolerating markdown fences."""
    # Try direct parse first
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    # Last resort: find first { ... }
    start = text.index("{")
    end = text.rindex("}") + 1
    return json.loads(text[start:end])


async def evaluate(
    archetype: Archetype,
    provider: LLMProvider,
    bundle: EvidenceBundle,
    iteration: int,
) -> Ballot | None:
    """Run a single evaluator agent and return a parsed Ballot, or None on failure."""
    user_prompt = _build_user_prompt(bundle)

    try:
        response = await provider.complete(
            system=archetype.system_prompt,
            user=user_prompt,
            temperature=0.8,
        )
    except Exception:
        logger.exception("LLM call failed for %s on %s", archetype.name, provider.model_id)
        return None

    try:
        data = _extract_json(response.content)
    except (json.JSONDecodeError, ValueError):
        logger.error(
            "Failed to parse JSON from %s (%s). Raw output:\n%s",
            archetype.name,
            provider.model_id,
            response.content,
        )
        return None

    try:
        return Ballot(
            iteration=iteration,
            archetype=archetype.name,
            model=response.model,
            vote=Vote(data["vote"]),
            supporting_evidence_ids=data.get("supporting_evidence_ids", []),
            refuting_evidence_ids=data.get("refuting_evidence_ids", []),
            rubric_scores=data.get("rubric_scores", {}),
            reasoning=data.get("reasoning", ""),
        )
    except Exception:
        logger.exception(
            "Failed to construct Ballot from %s (%s). Parsed data: %s",
            archetype.name,
            provider.model_id,
            data,
        )
        return None
