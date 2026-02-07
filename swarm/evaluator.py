from __future__ import annotations

import json
import logging
import re

from swarm.archetypes import Archetype
from swarm.models import LLMProvider
from swarm.schemas import Ballot, EvidenceBundle, Vote

logger = logging.getLogger(__name__)


def _build_user_prompt(bundle: EvidenceBundle) -> str:
    from datetime import datetime, timezone

    evidence_block = "\n".join(
        f"[Evidence {e.id}] {e.snippet} — source: {e.url} ({e.timestamp})"
        for e in bundle.evidence
    )
    rubric_block = ", ".join(bundle.rubric)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    return (
        f"TODAY'S DATE: {today}\n\n"
        f"QUESTION: {bundle.question}\n\n"
        f"EVALUATION RUBRIC: {rubric_block}\n\n"
        f"EVIDENCE BUNDLE:\n{evidence_block}\n\n"
        "Evaluate the question using ONLY the evidence above. "
        "Respond with a single JSON object and nothing else."
    )


def _sanitize_json(raw: str) -> str:
    """Fix common LLM JSON errors before parsing."""
    # Fix unquoted evidence references like [Evidence 2, Evidence 3] → [2, 3]
    raw = re.sub(r'\bEvidence\s+(\d+)\b', r'\1', raw)
    return raw


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from LLM output, tolerating markdown fences."""
    text = text.strip()

    # Try direct parse first
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return json.loads(_sanitize_json(text))

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        raw = match.group(1)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return json.loads(_sanitize_json(raw))

    # Last resort: find first { ... }
    start = text.index("{")
    end = text.rindex("}") + 1
    raw = text[start:end]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(_sanitize_json(raw))


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
