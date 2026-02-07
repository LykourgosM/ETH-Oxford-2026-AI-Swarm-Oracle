import { useMemo, useState } from "react";

const API_BASE = "http://localhost:8000";

type EvidenceItem = {
  id: number;
  url: string;
  snippet: string;
  quality_score: number;
  timestamp: string;
};

type Vote = "YES" | "NO" | "NULL";

type Ballot = {
  iteration: number;
  archetype: string;
  model: string;
  vote: Vote;
  supporting_evidence_ids: number[];
  refuting_evidence_ids: number[];
  rubric_scores: Record<string, number>;
  reasoning: string;
};

type ConvergencePoint = {
  iteration: number;
  p_yes: number;
  p_no: number;
  p_null: number;
};

type VerdictDistribution = {
  question: string;
  p_yes: number;
  p_no: number;
  p_null: number;
  num_iterations: number;
  committee_size: number;
  converged_at_iteration: number | null;
  credible_intervals_95: Record<string, [number, number]>;
  entropy: number;
  fleiss_kappa: number;
  effective_sample_size: number;
  ballots: Ballot[];
  convergence: ConvergencePoint[];
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// ===== MOCK SIMULATION (no API calls, no tokens spent) =====
const MOCK_ARCHETYPES = [
  "strict_empiricist", "permissive_interpreter", "skeptic",
  "source_quality_hawk", "contrarian"
];

function mockSimulation(
  evidence: EvidenceItem[],
  onSnapshot: (snap: ConvergencePoint) => void,
  onVerdict: (verdict: VerdictDistribution) => void,
  question: string
) {
  const NUM_ITER = 5;
  const COMMITTEE = 3;
  const allBallots: Ballot[] = [];
  let iter = 0;

  const interval = setInterval(() => {
    iter++;
    for (let k = 0; k < COMMITTEE; k++) {
      const arch = MOCK_ARCHETYPES[Math.floor(Math.random() * MOCK_ARCHETYPES.length)];
      const r = Math.random();
      const vote: Vote = r < 0.55 ? "YES" : r < 0.85 ? "NO" : "NULL";
      const ids = evidence.map(e => e.id);
      allBallots.push({
        iteration: iter,
        archetype: arch,
        model: "mock-local",
        vote,
        supporting_evidence_ids: ids.slice(0, 2),
        refuting_evidence_ids: ids.slice(2, 3),
        rubric_scores: {
          evidence_quality: +(0.5 + Math.random() * 0.4).toFixed(2),
          claim_specificity: +(0.4 + Math.random() * 0.4).toFixed(2),
          source_reliability: +(0.5 + Math.random() * 0.3).toFixed(2)
        },
        reasoning: vote === "YES" ? "Evidence supports the claim."
          : vote === "NO" ? "Evidence contradicts the claim."
          : "Insufficient evidence to decide."
      });
    }

    const total = allBallots.length;
    const p_yes = allBallots.filter(b => b.vote === "YES").length / total;
    const p_no = allBallots.filter(b => b.vote === "NO").length / total;
    const p_null = allBallots.filter(b => b.vote === "NULL").length / total;

    onSnapshot({ iteration: iter, p_yes, p_no, p_null });

    if (iter >= NUM_ITER) {
      clearInterval(interval);
      const z = 1.96;
      const se = Math.sqrt((p_yes * (1 - p_yes)) / total);
      onVerdict({
        question,
        p_yes, p_no, p_null,
        num_iterations: NUM_ITER,
        committee_size: COMMITTEE,
        converged_at_iteration: null,
        credible_intervals_95: {
          YES: [clamp01(p_yes - z * se), clamp01(p_yes + z * se)],
          NO: [clamp01(p_no - z * se), clamp01(p_no + z * se)],
          NULL: [clamp01(p_null - z * se), clamp01(p_null + z * se)]
        },
        entropy: 0,
        fleiss_kappa: 0,
        effective_sample_size: allBallots.length,
        ballots: allBallots,
        convergence: []
      });
    }
  }, 300);

  return () => clearInterval(interval);
}

// Demo-only "Merkle root" (not cryptographically correct — fine for MVP)
function fakeMerkleRoot(evidence: EvidenceItem[], question: string) {
  const base = JSON.stringify({ question, evidence }).length.toString(16);
  return "0x" + base.padStart(64, "0");
}

export default function App() {
  // ===== DEMO CONTENT =====
  const [question, setQuestion] = useState("Did Protocol Z's token launch create sustainable value?");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([
    {
      id: 1,
      url: "On-chain analytics dashboard",
      snippet:
        "Active wallet addresses interacting with Protocol Z increased 220% in the 30 days post-launch, indicating rapid user adoption.",
      quality_score: 0.85,
      timestamp: new Date().toISOString()
    },
    {
      id: 2,
      url: "DEX liquidity + price data",
      snippet: "Token price declined 48% from launch week highs, with liquidity incentives concentrated among early wallets.",
      quality_score: 0.8,
      timestamp: new Date().toISOString()
    },
    {
      id: 3,
      url: "Audit summary",
      snippet: "No critical vulnerabilities, but economic design risks were flagged around emissions and yield sustainability.",
      quality_score: 0.7,
      timestamp: new Date().toISOString()
    },
    {
      id: 4,
      url: "Governance forum snapshot",
      snippet: "Governance participation rose, but many proposals focus on incentive extensions rather than product improvements.",
      quality_score: 0.65,
      timestamp: new Date().toISOString()
    },
    {
      id: 5,
      url: "Integration announcement",
      snippet: "Protocol Z integrated into two major DeFi aggregators, increasing composability and cross-protocol utility.",
      quality_score: 0.75,
      timestamp: new Date().toISOString()
    },
    {
      id: 6,
      url: "DeFi research note",
      snippet: "APYs appear largely subsidy-driven; similar protocols saw user drop-offs after emissions tapered.",
      quality_score: 0.6,
      timestamp: new Date().toISOString()
    }
  ]);

  const [newUrl, setNewUrl] = useState("");
  const [newSnippet, setNewSnippet] = useState("");
  const [newQuality, setNewQuality] = useState(0.7);

  const [isFrozen, setIsFrozen] = useState(false);
  const merkleRoot = useMemo(() => fakeMerkleRoot(evidence, question), [evidence, question]);

  const addEvidence = () => {
    if (!newUrl.trim() || !newSnippet.trim()) return;
    const nextId = evidence.length ? Math.max(...evidence.map((e) => e.id)) + 1 : 1;
    setEvidence([
      ...evidence,
      {
        id: nextId,
        url: newUrl.trim(),
        snippet: newSnippet.trim(),
        quality_score: clamp01(newQuality),
        timestamp: new Date().toISOString()
      }
    ]);
    setNewUrl("");
    setNewSnippet("");
    setNewQuality(0.7);
    setIsFrozen(false);
  };

  const removeEvidence = (id: number) => {
    setEvidence(evidence.filter((e) => e.id !== id));
    setIsFrozen(false);
  };

  // ===== MODE TOGGLE =====
  const [useMock, setUseMock] = useState(true);

  // ===== RUN STATE =====
  const [running, setRunning] = useState(false);
  const [iteration, setIteration] = useState(0);
  const [numIterations, setNumIterations] = useState(0);
  const [committeeSize, setCommitteeSize] = useState(0);

  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [convergence, setConvergence] = useState<ConvergencePoint[]>([]);
  const [pYes, setPYes] = useState(0);
  const [pNo, setPNo] = useState(0);
  const [pNull, setPNull] = useState(0);
  const [ci95, setCi95] = useState<Record<string, [number, number]>>({ YES: [0, 0], NO: [0, 0], NULL: [0, 0] });
  const [fleissKappa, setFleissKappa] = useState(0);
  const [nEff, setNEff] = useState(0);
  const [convergedAt, setConvergedAt] = useState<number | null>(null);

  function resetRun() {
    setRunning(false);
    setIteration(0);
    setNumIterations(0);
    setCommitteeSize(0);
    setBallots([]);
    setConvergence([]);
    setPYes(0);
    setPNo(0);
    setPNull(0);
    setCi95({ YES: [0, 0], NO: [0, 0], NULL: [0, 0] });
    setFleissKappa(0);
    setNEff(0);
    setConvergedAt(null);
  }

  async function startRun() {
    resetRun();
    setRunning(true);

    if (useMock) {
      // Local mock — no API calls, no tokens
      mockSimulation(
        evidence,
        (snap) => {
          setIteration(snap.iteration);
          setPYes(snap.p_yes);
          setPNo(snap.p_no);
          setPNull(snap.p_null);
          setConvergence((prev) => [...prev, snap]);
        },
        (verdict) => {
          setPYes(verdict.p_yes);
          setPNo(verdict.p_no);
          setPNull(verdict.p_null);
          setCi95(verdict.credible_intervals_95);
          setFleissKappa(verdict.fleiss_kappa);
          setNEff(verdict.effective_sample_size);
          setConvergedAt(verdict.converged_at_iteration);
          setBallots(verdict.ballots);
          setNumIterations(verdict.num_iterations);
          setCommitteeSize(verdict.committee_size);
          setIteration(verdict.num_iterations);
          setRunning(false);
        },
        question
      );
      return;
    }

    // Real API call
    const bundle = {
      question,
      rubric: ["evidence_quality", "claim_specificity", "source_reliability"],
      evidence: evidence.map((e) => ({
        id: e.id,
        url: e.url,
        snippet: e.snippet,
        timestamp: e.timestamp,
        quality_score: e.quality_score
      })),
      merkle_root: merkleRoot
    };

    try {
      const response = await fetch(`${API_BASE}/evaluate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle)
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (eventType === "snapshot") {
              const snap = data as ConvergencePoint;
              setIteration(snap.iteration);
              setPYes(snap.p_yes);
              setPNo(snap.p_no);
              setPNull(snap.p_null);
              setConvergence((prev) => [...prev, snap]);
            } else if (eventType === "verdict") {
              const verdict = data as VerdictDistribution;
              setPYes(verdict.p_yes);
              setPNo(verdict.p_no);
              setPNull(verdict.p_null);
              setCi95(verdict.credible_intervals_95);
              setFleissKappa(verdict.fleiss_kappa);
              setNEff(verdict.effective_sample_size);
              setConvergedAt(verdict.converged_at_iteration);
              setBallots(verdict.ballots);
              setNumIterations(verdict.num_iterations);
              setCommitteeSize(verdict.committee_size);
              setIteration(verdict.num_iterations);
            }
          }
        }
      }
    } catch (err) {
      console.error("Swarm API error:", err);
    } finally {
      setRunning(false);
    }
  }

  const runDisabled = evidence.length === 0 || !question.trim() || running;

  return (
    <div
      style={{
        padding: 40,
        fontFamily: "system-ui",
        background: "#0f172a",
        minHeight: "100vh",
        color: "white"
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 10 }}>Veritas Swarm</h1>
      <p style={{ opacity: 0.8 }}>Monte Carlo Committee Oracle</p>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, marginTop: 24 }}>
        {/* Left: Question */}
        <div style={{ padding: 20, background: "#1e293b", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Question</h2>
          <textarea
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setIsFrozen(false);
            }}
            placeholder="Enter a question for the swarm..."
            data-gramm="false"
            data-gramm_editor="false"
            spellCheck={false}
            style={{
              width: "100%",
              height: 110,
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0b1220",
              color: "white",
              fontSize: 16,
              outline: "none",
              boxSizing: "border-box"
            }}
          />

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: isFrozen ? "rgba(16,185,129,0.15)" : "rgba(148,163,184,0.12)",
                color: isFrozen ? "#34d399" : "#cbd5e1",
                display: "inline-flex",
                alignItems: "center",
                gap: 8
              }}
            >
              {isFrozen ? "Evidence Frozen" : "Not Frozen"} • Merkle: {merkleRoot.slice(0, 10)}…{merkleRoot.slice(-6)}
            </span>

            <button
              onClick={() => setIsFrozen(true)}
              style={{
                marginLeft: "auto",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.16)",
                background: isFrozen ? "rgba(16,185,129,0.18)" : "rgba(59,130,246,0.18)",
                color: "white",
                cursor: "pointer"
              }}
            >
              Freeze Evidence
            </button>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(148,163,184,0.08)",
              border: "1px solid rgba(255,255,255,0.08)"
            }}
          >
            <span style={{ fontSize: 13, opacity: 0.8 }}>Mode:</span>
            <button
              onClick={() => setUseMock(true)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: useMock ? "rgba(234,179,8,0.25)" : "transparent",
                color: useMock ? "#fbbf24" : "#94a3b8",
                cursor: "pointer",
                fontWeight: useMock ? 700 : 400,
                fontSize: 13
              }}
            >
              Mock (free)
            </button>
            <button
              onClick={() => setUseMock(false)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: !useMock ? "rgba(34,197,94,0.25)" : "transparent",
                color: !useMock ? "#34d399" : "#94a3b8",
                cursor: "pointer",
                fontWeight: !useMock ? 700 : 400,
                fontSize: 13
              }}
            >
              Live API
            </button>
          </div>

          <button
            disabled={runDisabled}
            onClick={startRun}
            style={{
              marginTop: 14,
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.16)",
              background: runDisabled ? "rgba(148,163,184,0.12)" : "rgba(99,102,241,0.35)",
              color: "white",
              cursor: runDisabled ? "not-allowed" : "pointer",
              fontWeight: 700,
              opacity: runDisabled ? 0.6 : 1
            }}
          >
            {running ? "Running Swarm..." : "Run Monte Carlo Swarm"}
          </button>

          <button
            onClick={resetRun}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(148,163,184,0.10)",
              color: "white",
              cursor: "pointer",
              opacity: 0.9
            }}
          >
            Reset Run
          </button>

          <p style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
            Any change to question/evidence automatically unfreezes the bundle.
          </p>
        </div>

        {/* Right: Evidence Bundle */}
        <div
          style={{
            padding: 20,
            background: "#111827",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)"
          }}
        >
          <h2 style={{ marginTop: 0 }}>Evidence Bundle</h2>

          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Source URL (or label)"
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "#0b1220",
                color: "white",
                boxSizing: "border-box"
              }}
            />
            <textarea
              value={newSnippet}
              onChange={(e) => setNewSnippet(e.target.value)}
              placeholder="Snippet / excerpt (what the agent can cite)"
              data-gramm="false"
              data-gramm_editor="false"
              spellCheck={false}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "#0b1220",
                color: "white",
                height: 70,
                boxSizing: "border-box"
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontSize: 13, opacity: 0.8 }}>Quality</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={newQuality}
                onChange={(e) => setNewQuality(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ width: 44, textAlign: "right", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                {newQuality.toFixed(2)}
              </span>
              <button
                onClick={addEvidence}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(34,197,94,0.18)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {evidence.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "#0b1220",
                  border: "1px solid rgba(255,255,255,0.10)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 12,
                      padding: "4px 8px",
                      borderRadius: 8,
                      background: "rgba(148,163,184,0.12)",
                      color: "#e2e8f0"
                    }}
                  >
                    E{e.id}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      opacity: 0.9,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {e.url}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>q={e.quality_score.toFixed(2)}</span>
                  <button
                    onClick={() => removeEvidence(e.id)}
                    style={{ marginLeft: 6, border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9, lineHeight: 1.35 }}>{e.snippet}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== LIVE RUN PANEL ===== */}
      <div
        style={{
          marginTop: 22,
          padding: 20,
          background: "#0b1220",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.10)"
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Live Resolution</h2>
          <span style={{ opacity: 0.75 }}>
            Iteration {iteration}{numIterations > 0 ? `/${numIterations}` : ""}{committeeSize > 0 ? ` • Committee size ${committeeSize}` : ""}
          </span>
          <span style={{ marginLeft: "auto", opacity: 0.75 }}>
            {running ? "Running…" : iteration > 0 ? "Complete" : "Idle"}
          </span>
        </div>

        {/* Probability bars */}
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 90px", gap: 12, marginTop: 14, alignItems: "center" }}>
          {[
            { label: "P(YES)", v: pYes },
            { label: "P(NO)", v: pNo },
            { label: "P(NULL)", v: pNull }
          ].map((row) => (
            <div key={row.label} style={{ display: "contents" }}>
              <div style={{ opacity: 0.9 }}>{row.label}</div>
              <div style={{ height: 10, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
                <div style={{ width: `${Math.round(row.v * 100)}%`, height: "100%", background: "rgba(99,102,241,0.8)" }} />
              </div>
              <div style={{ fontFamily: "ui-monospace, Menlo, monospace", textAlign: "right" }}>{(row.v * 100).toFixed(1)}%</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, opacity: 0.8, fontSize: 13, display: "grid", gap: 4 }}>
          <div>
            95% Credible Intervals (Dirichlet posterior):{" "}
          </div>
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", paddingLeft: 12 }}>
            YES: [{(ci95.YES?.[0] * 100 || 0).toFixed(1)}%, {(ci95.YES?.[1] * 100 || 0).toFixed(1)}%]
            {" "} NO: [{(ci95.NO?.[0] * 100 || 0).toFixed(1)}%, {(ci95.NO?.[1] * 100 || 0).toFixed(1)}%]
            {" "} NULL: [{(ci95.NULL?.[0] * 100 || 0).toFixed(1)}%, {(ci95.NULL?.[1] * 100 || 0).toFixed(1)}%]
          </div>
        </div>

        {/* New statistics */}
        <div style={{ marginTop: 12, display: "flex", gap: 20, fontSize: 13, opacity: 0.8 }}>
          <span>
            Fleiss' Kappa:{" "}
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700 }}>
              {fleissKappa.toFixed(3)}
            </span>
            <span style={{ opacity: 0.7, marginLeft: 4 }}>
              ({fleissKappa < 0.2 ? "high subjectivity" : fleissKappa < 0.6 ? "moderate agreement" : "strong agreement"})
            </span>
          </span>
          <span>
            Effective N:{" "}
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700 }}>
              {nEff.toFixed(1)}
            </span>
            <span style={{ opacity: 0.7 }}> / {ballots.length} ballots</span>
          </span>
          {convergedAt && (
            <span>
              Converged at iteration{" "}
              <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700 }}>{convergedAt}</span>
            </span>
          )}
        </div>

        {/* Convergence mini-strip */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Convergence (P(YES) over iterations)</div>
          <div style={{ display: "flex", gap: 2, height: 36, alignItems: "flex-end" }}>
            {convergence.map((pt) => (
              <div
                key={pt.iteration}
                title={`iter ${pt.iteration}: ${(pt.p_yes * 100).toFixed(1)}%`}
                style={{
                  width: 6,
                  height: `${Math.max(2, Math.round(pt.p_yes * 36))}px`,
                  borderRadius: 3,
                  background: "rgba(34,197,94,0.75)",
                  opacity: 0.95
                }}
              />
            ))}
          </div>
        </div>

        {/* Ballot feed */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Committee ballots (latest first)</div>
          <div style={{ maxHeight: 190, overflowY: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)" }}>
            {ballots
              .slice()
              .reverse()
              .slice(0, 80)
              .map((b, idx) => (
                <div
                  key={`${b.iteration}-${b.archetype}-${idx}`}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    gridTemplateColumns: "90px 200px 70px 1fr",
                    gap: 10,
                    fontSize: 13,
                    alignItems: "baseline"
                  }}
                >
                  <span style={{ fontFamily: "ui-monospace, Menlo, monospace", opacity: 0.85 }}>iter {b.iteration}</span>
                  <span style={{ opacity: 0.9 }}>{b.archetype}</span>
                  <span style={{ fontWeight: 800 }}>{b.vote}</span>
                  <span style={{ opacity: 0.75 }}>{b.reasoning}</span>
                </div>
              ))}
            {ballots.length === 0 && (
              <div style={{ padding: 12, opacity: 0.75, fontSize: 13 }}>
                Click <b>Run Monte Carlo Swarm</b> to stream ballots.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
