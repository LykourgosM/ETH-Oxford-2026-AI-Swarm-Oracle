"""Evidence collector — runs search queries via Tavily and returns raw results."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from tavily import AsyncTavilyClient

load_dotenv()
logger = logging.getLogger(__name__)


async def collect(queries: list[str], max_results_per_query: int = 3) -> list[dict]:
    """Run search queries via Tavily and return deduplicated evidence items.

    Each item has: url, snippet, timestamp.
    """
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY not set in .env")

    client = AsyncTavilyClient(api_key=api_key)
    seen_urls: set[str] = set()
    results: list[dict] = []

    for query in queries:
        try:
            response = await client.search(
                query=query,
                max_results=max_results_per_query,
                include_answer=False,
            )
        except Exception:
            logger.exception("Tavily search failed for query: %s", query)
            continue

        for item in response.get("results", []):
            url = item.get("url", "")
            if url in seen_urls:
                continue
            seen_urls.add(url)

            snippet = item.get("content", "")
            # Trim snippet to ~200 words
            words = snippet.split()
            if len(words) > 200:
                snippet = " ".join(words[:200]) + "..."

            timestamp = item.get("published_date") or datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )

            results.append({
                "url": url,
                "snippet": snippet,
                "timestamp": timestamp,
            })

    logger.info("Collected %d evidence items from %d queries", len(results), len(queries))

    # Cap at 6 items to keep the swarm prompt lean
    return results[:6]
