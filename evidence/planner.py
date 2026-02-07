"""Planner agent — generates search queries and evaluation rubric from a question."""
from __future__ import annotations

import json
import logging
import re

from swarm.models import OpenAIProvider

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a research planner for a DeFi oracle. Given a user question, produce:
1. search_queries — 3-5 targeted web search queries to find evidence for/against the claim
2. rubric — 3 evaluation criteria the swarm should use (e.g. evidence_quality, claim_specificity, source_reliability)

Respond with a single JSON object:
{
  "search_queries": ["query1", "query2", "query3"],
  "rubric": ["criterion1", "criterion2", "criterion3"]
}
"""

DEFAULT_RUBRIC = ["evidence_quality", "claim_specificity", "source_reliability"]


async def plan(question: str) -> tuple[list[str], list[str]]:
    """Generate search queries and rubric for a question.

    Returns (search_queries, rubric).
    """
    provider = OpenAIProvider()

    try:
        response = await provider.complete(
            system=SYSTEM_PROMPT,
            user=question,
            temperature=0.4,
        )
        data = _parse_response(response.content)
        queries = data.get("search_queries", [])
        rubric = data.get("rubric", DEFAULT_RUBRIC)

        if not queries:
            logger.warning("Planner returned no queries, using fallback")
            queries = [question]

        logger.info("Planner generated %d queries: %s", len(queries), queries)
        return queries, rubric

    except Exception:
        logger.exception("Planner failed, using fallback")
        return [question], DEFAULT_RUBRIC


def _parse_response(text: str) -> dict:
    """Extract JSON from the planner response."""
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)

    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))

    start = text.index("{")
    end = text.rindex("}") + 1
    return json.loads(text[start:end])
