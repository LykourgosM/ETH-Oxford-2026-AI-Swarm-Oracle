# Swarm Core — Build Guide (Person 1)

## What You're Building

The core engine that takes a **question + evidence bundle** and produces a **verdict distribution** by Monte Carlo sampling random committees of AI evaluators.

---

## Input (from Person 2's Evidence Pipeline)

You'll receive a JSON evidence bundle:

```json
{
  "question": "Did Project X deliver on its Q4 roadmap?",
  "rubric": ["evidence_quality", "claim_specificity", "source_reliability"],
  "evidence": [
    {
      "id": 1,
      "url": "https://...",
      "snippet": "Project X shipped features A and B but delayed C...",
      "timestamp": "2026-02-01T12:00:00Z",
      "quality_score": 0.8
    }
  ],
  "merkle_root": "0xabc..."
}
```

**Mock this early** so you can work independently. Create 2-3 hardcoded evidence bundles with different questions to test against.

---

## Output (to Person 3's Frontend)

```json
{
  "question": "Did Project X deliver on its Q4 roadmap?",
  "p_yes": 0.62,
  "p_no": 0.28,
  "p_null": 0.10,
  "num_iterations": 50,
  "committee_size": 5,
  "confidence_interval_95": [0.54, 0.70],
  "ballots": [
    {
      "iteration": 1,
      "archetype": "strict_empiricist",
      "model": "claude-sonnet-4-5-20250929",
      "vote": "YES",
      "supporting_evidence_ids": [1, 4],
      "refuting_evidence_ids": [2],
      "rubric_scores": {
        "evidence_quality": 0.7,
        "claim_specificity": 0.5,
        "source_reliability": 0.8
      },
      "reasoning": "Brief explanation..."
    }
  ],
  "convergence": [
    {"iteration": 1, "p_yes": 0.60, "p_no": 0.40, "p_null": 0.00},
    {"iteration": 2, "p_yes": 0.50, "p_no": 0.30, "p_null": 0.20}
  ]
}
```

The `convergence` array lets the frontend animate the distribution settling over time.

---

## Components to Build

### 1. Archetype Definitions

Create prompt templates for each evaluator persona. Each archetype needs:
- A system prompt defining its evaluation style
- Instructions to ONLY reference evidence from the bundle (by ID)
- A required output schema (the ballot JSON)

**Start with 5, expand to 9+ if time allows:**

| Archetype | Behaviour |
|---|---|
| `strict_empiricist` | Only votes YES/NO if hard data directly supports it, otherwise NULL |
| `permissive_interpreter` | Willing to infer from indirect evidence, leans toward a verdict |
| `skeptic` | Defaults to NULL, needs overwhelming evidence to vote YES or NO |
| `source_quality_hawk` | Weighs source reliability heavily, discounts low-quality evidence |
| `contrarian` | Actively looks for reasons the obvious answer is wrong |

Later additions: `methodologist`, `legalistic_reader`, `quantifier`, `consensus_seeker`

**Implementation:** each archetype is a function that takes (question, rubric, evidence[]) and returns a system prompt string.

### 2. Committee Sampler

```
function sample_committee(archetypes[], committee_size M) -> archetype[]
```

- Randomly sample M archetypes from the pool of N (with or without replacement — your call, but without replacement makes committees more diverse)
- M = 3-5 is a good default committee size
- Return the selected archetypes for this iteration

### 3. Evaluator Runner

For each agent in a committee:
- Build the full prompt: system prompt (archetype) + user prompt (question + evidence + rubric)
- Call the LLM API
- Parse the structured ballot from the response
- Handle failures gracefully (if an LLM call fails or returns garbage, log it and skip)

**Key decisions:**
- Use structured output / JSON mode where available
- Run agents within a committee **in parallel** (async) for speed
- Set temperature > 0 (e.g. 0.7-1.0) — you want genuine variance between runs

### 4. Monte Carlo Loop

```
for i in 1..num_iterations:
    committee = sample_committee(archetypes, M)
    ballots = run_committee(committee, question, evidence)  # parallel
    all_ballots.extend(ballots)
    update_running_distribution(all_ballots)
    record_convergence_snapshot(i, running_distribution)
```

- Default: **30-50 iterations** (tune based on API speed vs demo time)
- Optionally implement **early stopping**: if the distribution hasn't shifted by more than epsilon for the last K iterations, stop early
- Emit intermediate results so the frontend can stream updates

### 5. Aggregator

Simple vote counting over all ballots:

```
p_yes  = count(YES)  / total_ballots
p_no   = count(NO)   / total_ballots
p_null = count(NULL) / total_ballots
```

Also compute:
- **95% confidence interval** on p_yes using a binomial proportion CI (Wilson score or normal approx)
- **Entropy** of the distribution as an uncertainty metric

### 6. Multi-Model Support

Route different archetypes through different LLM providers:

```python
MODEL_POOL = [
    {"provider": "anthropic", "model": "claude-sonnet-4-5-20250929"},
    {"provider": "openai", "model": "gpt-4o"},
    {"provider": "together", "model": "meta-llama/Llama-3-70b"},
]
```

- Each archetype instance gets a randomly assigned model from the pool
- Abstract the LLM call behind a common interface so swapping models is trivial
- **Start with one model** (whichever API key you have), add more later

---

## Suggested File Structure

```
swarm/
  archetypes/
    strict_empiricist.py
    permissive_interpreter.py
    skeptic.py
    source_quality_hawk.py
    contrarian.py
  sampler.py          # committee sampling logic
  evaluator.py        # LLM call + ballot parsing
  aggregator.py       # vote counting + stats
  runner.py           # monte carlo loop orchestrator
  models.py           # multi-model provider abstraction
  schemas.py          # pydantic models for ballot, evidence, verdict
  mock_evidence.py    # hardcoded test bundles
```

---

## Build Order

1. **schemas.py** — define the data shapes (evidence bundle, ballot, verdict)
2. **mock_evidence.py** — 2-3 hardcoded evidence bundles
3. **One archetype** — get a single evaluator producing a valid ballot
4. **evaluator.py** — LLM call + parsing working end-to-end
5. **sampler.py + runner.py** — Monte Carlo loop with 1 archetype
6. **aggregator.py** — distribution + confidence intervals
7. **More archetypes** — expand to 5+
8. **Multi-model** — add a second LLM provider
9. **Streaming** — emit intermediate results for the frontend

**Milestone 1** (get here ASAP): one archetype, one model, hardcoded evidence, producing a ballot.
**Milestone 2**: full Monte Carlo loop with 5 archetypes, distribution output.
**Milestone 3**: multi-model, streaming to frontend.

---

## API Surface for Person 3

Expose a single endpoint or function:

```
POST /evaluate
Body: { evidence_bundle }
Response: { verdict_distribution }  (or SSE stream of convergence snapshots)
```

If using SSE/WebSocket streaming, emit a convergence snapshot after each iteration so the frontend can animate live.

---

## Gotchas

- **LLM output parsing will break.** Budget time for robust JSON extraction. Use structured output modes, or fall back to regex extraction from markdown code blocks.
- **Rate limits.** 50 iterations x 5 agents = 250 LLM calls. Use async/parallel but respect provider rate limits. Consider batching.
- **Temperature matters.** If temperature = 0, the same archetype will always vote the same way, defeating the point of Monte Carlo sampling. Use 0.7+.
- **Keep archetype prompts tight.** Long prompts = slow + expensive. The persona description can be 3-5 sentences.
- **Log everything.** Every ballot, every prompt, every raw LLM response. You'll need it for debugging and the demo.
