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
    p_yes: float                                         # posterior mean from Dirichlet
    p_no: float                                          # posterior mean from Dirichlet
    p_null: float                                        # posterior mean from Dirichlet
    num_iterations: int
    committee_size: int
    converged_at_iteration: int | None                   # null if didn't converge early
    credible_intervals_95: dict[str, tuple[float, float]]  # CIs for all 3 outcomes
    entropy: float
    fleiss_kappa: float                                  # inter-rater reliability
    effective_sample_size: float                         # discounted for model correlation
    ballots: list[Ballot]
    convergence: list[ConvergenceSnapshot]
