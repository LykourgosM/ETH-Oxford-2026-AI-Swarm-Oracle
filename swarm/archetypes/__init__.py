from __future__ import annotations

from dataclasses import dataclass

from swarm.archetypes.strict_empiricist import STRICT_EMPIRICIST
from swarm.archetypes.permissive_interpreter import PERMISSIVE_INTERPRETER
from swarm.archetypes.skeptic import SKEPTIC
from swarm.archetypes.source_quality_hawk import SOURCE_QUALITY_HAWK
from swarm.archetypes.contrarian import CONTRARIAN


@dataclass
class Archetype:
    name: str
    system_prompt: str


ALL_ARCHETYPES: list[Archetype] = [
    Archetype(name="strict_empiricist", system_prompt=STRICT_EMPIRICIST),
    Archetype(name="permissive_interpreter", system_prompt=PERMISSIVE_INTERPRETER),
    Archetype(name="skeptic", system_prompt=SKEPTIC),
    Archetype(name="source_quality_hawk", system_prompt=SOURCE_QUALITY_HAWK),
    Archetype(name="contrarian", system_prompt=CONTRARIAN),
]
