"""Quality scoring for evidence sources based on domain reputation."""
from __future__ import annotations

from urllib.parse import urlparse

DOMAIN_SCORES: dict[str, float] = {
    "etherscan.io": 0.95,
    "blog.uniswap.org": 0.90,
    "ethereum.org": 0.90,
    "dune.com": 0.85,
    "l2beat.com": 0.85,
    "reuters.com": 0.85,
    "bloomberg.com": 0.85,
    "coindesk.com": 0.75,
    "theblock.co": 0.75,
    "decrypt.co": 0.70,
    "cointelegraph.com": 0.65,
    "defillama.com": 0.85,
    "github.com": 0.80,
    "arxiv.org": 0.90,
    "mirror.xyz": 0.60,
    "medium.com": 0.50,
    "twitter.com": 0.25,
    "x.com": 0.25,
    "reddit.com": 0.30,
}

# Unknown domains get a low score — be conservative
DEFAULT_SCORE = 0.3


def score_quality(url: str) -> float:
    """Return a quality score (0-1) for a URL based on its domain."""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return DEFAULT_SCORE

    # Strip www. prefix
    if host.startswith("www."):
        host = host[4:]

    # Check exact match first, then check if domain ends with a known suffix
    if host in DOMAIN_SCORES:
        return DOMAIN_SCORES[host]
    for domain, score in DOMAIN_SCORES.items():
        if host.endswith("." + domain) or host == domain:
            return score
    return DEFAULT_SCORE
