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
```

---

## Prediction Market Integration

Veritas Swarm is designed to serve as the **resolution layer for on-chain prediction markets**.

A prediction market contract poses a subjective question (e.g. *"Did Project X deliver on its roadmap promises?"*). Instead of relying on a single oracle or a DAO vote, the market delegates resolution to Veritas Swarm, which returns a **verdict distribution** — P(YES), P(NO), P(NULL) — along with uncertainty metrics.

**Settlement flow:**
1. Market contract submits a question + resolution deadline to the oracle
2. Evidence Collector gathers and freezes an evidence bundle (Merkle root posted on-chain)
3. Monte Carlo committee sampling produces a verdict distribution
4. The distribution is posted on-chain; the market settles proportionally or by majority threshold

This gives prediction markets **calibrated, auditable resolution** with explicit uncertainty — rather than a single binary answer from an opaque source.

---

## Extensions

### 1. Participant-Submitted Evidence

As an extension, prediction market participants can **submit additional evidence** to the swarm before resolution.

- Participants who hold YES or NO positions can submit URLs, documents, or data that support their side
- Submitted evidence is hashed and appended to the evidence bundle (new Merkle root computed)
- The swarm re-evaluates with the expanded evidence set, and the verdict distribution shifts accordingly

This creates a **skin-in-the-game information market**: participants are economically incentivised to surface the best possible evidence, because better evidence shifts the distribution in their favour. The result is a resolution process that actively solicits adversarial, high-quality information rather than relying solely on automated collection.

### 2. Multi-Model Heterogeneity

To strengthen the independence of evaluator archetypes, the swarm can sample across **different underlying foundation models** rather than prompting a single model with different personas.

For example, a single committee might include:
- a Claude-based strict empiricist
- a GPT-based contrarian
- a Llama-based skeptic
- a Gemini-based quantifier

This provides **true model diversity** — different training data, different biases, different failure modes — making the committee's aggregate judgement more robust than any prompt-engineering-only approach. It also mitigates the risk of systematic bias from a single model provider.
