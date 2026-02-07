from __future__ import annotations

import random

from swarm.archetypes import Archetype
from swarm.models import LLMProvider


def sample_committee(
    archetypes: list[Archetype],
    providers: list[LLMProvider],
    committee_size: int,
) -> list[tuple[Archetype, LLMProvider]]:
    """Sample a random committee of (archetype, provider) pairs.

    Archetypes are sampled without replacement (for diversity within a committee).
    Each selected archetype is randomly assigned a provider from the pool.
    """
    size = min(committee_size, len(archetypes))
    selected = random.sample(archetypes, size)
    return [(arch, random.choice(providers)) for arch in selected]
