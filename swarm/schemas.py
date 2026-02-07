from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field


# ── Evidence ────────────────────────────────────────────────────────

class EvidenceItem(BaseModel):
    id: int
    url: str
    snippet: str
    timestamp: str
    quality_score: float = Field(ge=0.0, le=1.0)


class EvidenceBundle(BaseModel):
    question: str
    rubric: list[str]
    evidence: list[EvidenceItem]
    merkle_root: str


# ── Ballots ─────────────────────────────────────────────────────────

class Vote(str, Enum):
    YES = "YES"
    NO = "NO"
    NULL = "NULL"


class Ballot(BaseModel):
    iteration: int
    archetype: str
    model: str
    vote: Vote
    supporting_evidence_ids: list[int] = Field(default_factory=list)
    refuting_evidence_ids: list[int] = Field(default_factory=list)
    rubric_scores: dict[str, float] = Field(default_factory=dict)
    reasoning: str = ""


# ── Aggregated output ───────────────────────────────────────────────

class ConvergenceSnapshot(BaseModel):
    iteration: int
    p_yes: float
    p_no: float
    p_null: float


class VerdictDistribution(BaseModel):
    question: str
    p_yes: float
    p_no: float
    p_null: float
    num_iterations: int
    committee_size: int
    confidence_interval_95: tuple[float, float]
    entropy: float
    ballots: list[Ballot]
    convergence: list[ConvergenceSnapshot]
