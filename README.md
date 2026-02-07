# ETH-Oxford-2026-AI-Swarm-Oracle
Monte-Carlo AI Swarm DeFi Oracle

# Veritas Swarm  
**Monte Carlo Committee Oracle for Subjective Truth**

Veritas Swarm is an experimental **interpretive oracle** that resolves subjective, real-world questions by estimating a **distribution over outcomes** rather than emitting a single answer.

Instead of relying on one “judge” model, Veritas Swarm **Monte-Carlo samples random committees of heterogeneous AI evaluators** over a *frozen, verifiable evidence bundle*. Each committee votes **YES / NO / NULL**, and repeated sampling produces an empirical verdict distribution with explicit uncertainty.

The core novelty is treating oracle resolution as a **stochastic evaluation process**, not a deterministic prediction.

---

## Key Idea

> Subjective truth should not pretend to be certain.

Humans disagree on complex questions. Veritas Swarm embraces this by:
- freezing a shared evidence set,
- sampling diverse evaluator committees,
- and estimating **P(YES), P(NULL), P(NO)** directly.

Challenges don’t just flip an answer — they **reshape the probability mass**.

---

## High-Level Architecture
User Question
│
▼
Planner Agent
│
▼
Evidence Collector  ──► Evidence Bundle (hashed + Merkle root)
│
▼
Monte Carlo Committee Sampler
│
├─ Iteration 1: sample M agents → ballots
├─ Iteration 2: sample M agents → ballots
├─ …
▼
Deterministic Aggregator
│
▼
Verdict Distribution + Uncertainty Metrics

---

## Core Concepts

### 1. Frozen Evidence Bundle
Evidence is collected **once** and then locked:
- URLs
- quoted snippets
- timestamps
- source quality scores

Each evidence item is hashed, and a **Merkle root** is computed for the full bundle.  
All later evaluation stages reference evidence **by ID only**.

This makes outcomes **auditable, reproducible, and challengeable**.

---

### 2. Agent Archetypes (N)
Instead of identical agents, Veritas Swarm defines **heterogeneous evaluator archetypes**, each encoding a different prior or evaluation style.

Example archetypes:
- Strict empiricist
- Permissive interpreter
- Skeptic (defaults to NULL)
- Methodologist (causality-focused)
- Source-quality hawk
- Legalistic reader
- Contrarian
- Quantifier
- Consensus-seeker

Each archetype is:
- a prompt template
- constrained to the frozen evidence
- required to emit a structured ballot

---

### 3. Monte Carlo Committee Sampling
For each iteration:
- sample **M archetypes** from the pool of N
- each agent independently evaluates the question
- each agent outputs a **ballot**:

```json
{
  "vote": "YES | NO | NULL",
  "supporting_evidence_ids": [1, 4],
  "refuting_evidence_ids": [2],
  "rubric_scores": {
    "criterion_1": 0.7,
    "criterion_2": 0.4
  }
}
