# Veritas Swarm

**Monte Carlo Committee Oracle for Subjective Truth Resolution**

Veritas Swarm is a Bayesian oracle that resolves subjective, real-world questions by Monte Carlo sampling of adversarial AI agent committees over a cryptographically committed evidence bundle. The system produces a posterior probability distribution over outcomes with credible intervals, convergence diagnostics, and inter-rater reliability statistics — all posted on-chain for verifiability.

## Demo

![Veritas Swarm Demo](demo.gif)

---

## Architecture

```
User Question
│
▼
Planner Agent (LLM) ──► search queries + evaluation rubric
│
▼
Evidence Collector (Tavily) ──► deduplicated web sources
│
▼
Merkle Commitment ──► SHA-256 hash tree (question as first leaf)
│
▼
Monte Carlo Committee Sampler
│
├─ Iteration 1: sample M archetypes → structured ballots
├─ Iteration 2: sample M archetypes → structured ballots
├─ … (KL-divergence early stopping)
▼
Dirichlet-Multinomial Aggregator
│
▼
Verdict Distribution: P(YES), P(NO), P(NULL)
+ 95% credible intervals
+ Fleiss' κ, n_eff, entropy
│
▼
On-Chain (Sepolia) ──► VeritasOracle.sol
```

---

## Mathematical Framework

### 1. Dirichlet-Multinomial Posterior

Let the outcome space be $\mathcal{K} = \{\text{YES}, \text{NO}, \text{NULL}\}$. After $N$ committee ballots with observed vote counts $\mathbf{n} = (n_Y, n_N, n_\emptyset)$, we place a symmetric Dirichlet prior and compute the posterior:

$$\boldsymbol{\theta} \mid \mathbf{n} \sim \text{Dir}(n_Y + 1, \; n_N + 1, \; n_\emptyset + 1)$$

The posterior mean for each outcome $k$ is:

$$\hat{P}(k) = \frac{n_k + 1}{\displaystyle\sum_{j \in \mathcal{K}} n_j + |\mathcal{K}|}$$

The uniform prior $\text{Dir}(1, 1, 1)$ encodes maximum ignorance over the simplex and satisfies **Cromwell's rule**: no outcome is assigned zero probability regardless of the observed data.

**95% credible intervals** are computed by drawing $S = 10{,}000$ samples from $\text{Dir}(\boldsymbol{\alpha})$ and taking the 2.5th and 97.5th percentiles:

$$\text{CI}_{95}(k) = \left[ \; q_{0.025}(\theta_k^{(1:S)}), \;\; q_{0.975}(\theta_k^{(1:S)}) \; \right]$$

### 2. Monte Carlo Committee Sampling

At each iteration $t \in \{1, \dots, T\}$, a committee of $M$ agents is sampled uniformly with replacement from a pool of $A$ adversarial archetypes. Each agent $a_i$ independently produces a structured ballot:

$$b_i = (v_i, \; \mathbf{s}_i^+, \; \mathbf{s}_i^-, \; \mathbf{r}_i, \; \text{reasoning}_i)$$

where $v_i \in \mathcal{K}$ is the vote, $\mathbf{s}_i^+$ and $\mathbf{s}_i^-$ are supporting and refuting evidence IDs, and $\mathbf{r}_i$ is a vector of rubric scores.

The total ballot set after $T$ iterations is $\mathcal{B} = \{b_1, \dots, b_{MT}\}$, from which the Dirichlet posterior is computed.

### 3. KL-Divergence Convergence Detection

After each iteration $t$, let $P_t$ denote the current posterior mean. We compute the Kullback-Leibler divergence from the previous iteration:

$$D_{\text{KL}}(P_t \| P_{t-1}) = \sum_{k \in \mathcal{K}} P_t(k) \log_2 \frac{P_t(k)}{P_{t-1}(k)}$$

Early stopping is triggered when $D_{\text{KL}} < \varepsilon$ for $\tau$ consecutive iterations, where $\varepsilon$ and $\tau$ are configurable thresholds. This allows well-determined questions to resolve with fewer iterations while contentious questions consume the full budget.

### 4. Fleiss' Kappa (Inter-Rater Reliability)

With $T$ iterations (subjects), $M$ raters per iteration, and $|\mathcal{K}| = 3$ categories, Fleiss' kappa measures agreement beyond chance:

$$\kappa = \frac{\bar{P} - \bar{P}_e}{1 - \bar{P}_e}$$

where:

$$\bar{P} = \frac{1}{T} \sum_{t=1}^{T} \frac{\displaystyle\sum_{k \in \mathcal{K}} n_{tk}^2 - M}{M(M-1)}, \qquad \bar{P}_e = \sum_{k \in \mathcal{K}} \left(\frac{\displaystyle\sum_{t=1}^{T} n_{tk}}{TM}\right)^2$$

The interpretation: $\kappa < 0.2$ indicates high subjectivity (the question is genuinely contentious), $0.2 \leq \kappa < 0.6$ indicates moderate agreement, and $\kappa \geq 0.6$ indicates strong consensus.

### 5. Effective Sample Size

Since all agents share an underlying language model, ballot independence is violated. We correct for within-model correlation $\rho$ using the design effect:

$$n_{\text{eff}} = \frac{N}{1 + (\bar{m} - 1)\hat{\rho}}$$

where $\bar{m}$ is the mean cluster size per model and $\hat{\rho}$ is estimated from within-cluster vote agreement relative to the chance baseline of $1/|\mathcal{K}|$:

$$\hat{\rho} = \max\!\left(0, \; \frac{\bar{a} - 1/|\mathcal{K}|}{1 - 1/|\mathcal{K}|}\right)$$

where $\bar{a}$ is the mean proportion of the most-common vote within each model cluster.

### 6. Shannon Entropy

The entropy of the verdict distribution quantifies residual uncertainty:

$$H(\boldsymbol{\theta}) = -\sum_{k \in \mathcal{K}} \hat{P}(k) \log_2 \hat{P}(k)$$

Maximum entropy ($\log_2 3 \approx 1.585$ bits) indicates uniform uncertainty; entropy near zero indicates a decisive verdict.

---

## Adversarial Archetypes

The agent pool consists of $A = 5$ archetypes, each defined by a distinct system prompt encoding a different epistemic prior:

| Archetype | Evaluation Bias |
|---|---|
| **Strict Empiricist** | Demands direct, quantitative evidence. Ignores qualitative claims. |
| **Permissive Interpreter** | Accepts indirect and contextual signals. Lowers the bar for evidence sufficiency. |
| **Skeptic** | Defaults to NULL. Requires extraordinary evidence to vote YES or NO. |
| **Source Quality Hawk** | Judges credibility from the source URL and publication context. Ignores low-quality sources. |
| **Contrarian** | Structurally argues the minority position to stress-test consensus. |

This adversarial design prevents groupthink: the contrarian pushes back on emerging consensus, the skeptic anchors toward NULL, and the empiricist demands data the interpreter might waive through.

---

## Evidence Pipeline

1. **Planner** — An LLM generates 3–5 targeted search queries and an evaluation rubric from the user's question.
2. **Collector** — Tavily API executes the queries, deduplicates by URL, trims snippets to 200 words, caps at 6 items.
3. **Merkle Commitment** — Each evidence item is SHA-256 hashed. The question is hashed as the first leaf. A binary Merkle tree produces the root, committing to both the question and the evidence set.

The Merkle root is posted on-chain alongside the verdict, ensuring the evidence bundle is tamper-evident and auditable.

---

## On-Chain Verifiability

The `VeritasOracle` contract (Solidity ^0.8.24, deployed on Sepolia) stores each verdict as:

```solidity
struct Verdict {
    bytes32 questionHash;   // SHA-256 of the question
    bytes32 merkleRoot;     // Merkle root of question + evidence
    uint256 pYes;           // scaled by 1e18
    uint256 pNo;            // scaled by 1e18
    uint256 pNull;          // scaled by 1e18
    uint256 fleissKappa;    // scaled by 1e18
    uint256 timestamp;      // block.timestamp
}
```

All verdicts are publicly readable via `getVerdict(id)` and `verdictCount()`. The `VerdictPosted` event is emitted for indexing.

---

## Stack

| Layer | Technology |
|---|---|
| LLM | OpenAI gpt-4o-mini |
| Evidence Search | Tavily API |
| Backend | Python, FastAPI, web3.py |
| Frontend | React, Vite, SSE streaming |
| Blockchain | Solidity, Sepolia testnet, Foundry |
| Statistics | NumPy (Dirichlet sampling) |

---

## Configuration

| Parameter | Default | Description |
|---|---|---|
| `NUM_ITERATIONS` | 10 | Maximum Monte Carlo iterations |
| `COMMITTEE_SIZE` | 3 | Agents per committee per iteration |
| `TEMPERATURE` | 0.8 | LLM sampling temperature |
| `CONVERGENCE_THRESHOLD` | 0.01 | KL-divergence $\varepsilon$ for early stopping |
| `CONVERGENCE_PATIENCE` | 2 | Consecutive iterations below $\varepsilon$ to trigger stop |

---

## Extensions

### Participant-Submitted Evidence

Prediction market participants submit additional evidence before resolution. Submitted items are hashed, appended to the bundle (new Merkle root computed), and the swarm re-evaluates. This creates a skin-in-the-game information market: participants are economically incentivised to surface high-quality evidence because better evidence shifts the distribution in their favour.

### Multi-Model Heterogeneity

To strengthen ballot independence, the swarm can sample across different foundation models (Claude, GPT, Llama, Gemini) rather than prompting a single model with different personas. This provides true model diversity — different training data, different biases, different failure modes — and would increase $n_{\text{eff}}$ toward $N$.

---

## Setup

```bash
# Backend
cp .env.example .env  # fill in API keys
pip install -r requirements.txt
uvicorn api:app --reload

# Frontend
cd veritas-swarm-ui
npm install
npm run dev
```

Required environment variables: `OPENAI_API_KEY`, `TAVILY_API_KEY`, `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `CONTRACT_ADDRESS`.
