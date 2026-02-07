import { useMemo, useRef, useState } from "react";

type EvidenceItem = {
  id: number;
  url: string;
  snippet: string;
  quality: number; // 0..1
};

type Vote = "YES" | "NO" | "NULL";

type Ballot = {
  iteration: number;
  archetype: string;
  vote: Vote;
  supporting_evidence_ids: number[];
  refuting_evidence_ids: number[];
  rubric_scores: {
    evidence_quality: number;
    claim_specificity: number;
    source_reliability: number;
  };
  reasoning: string;
};

type ConvergencePoint = {
  iteration: number;
  p_yes: number;
  p_no: number;
  p_null: number;
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

// Demo-only "Merkle root" (not cryptographically correct — fine for MVP)
function fakeMerkleRoot(evidence: EvidenceItem[], question: string) {
  const base = JSON.stringify({ question, evidence }).length.toString(16);
  return "0x" + base.padStart(64, "0");
}

// Lightweight keyword scoring so the run is coherent (not pure random noise)
function evidenceSignal(evidence: EvidenceItem[]) {
  const posWords = ["increase", "grew", "adoption", "integrat", "utility", "partnership", "compos", "growth"];
  const negWords = ["decline", "fell", "risk", "insider", "concentrat", "subsid", "drop", "taper", "postpone"];

  let score = 0;
  for (const e of evidence) {
    const s = e.snippet.toLowerCase();
    const pos = posWords.some((w) => s.includes(w)) ? 1 : 0;
    const neg = negWords.some((w) => s.includes(w)) ? 1 : 0;
    score += (pos - neg) * e.quality; // -1..+1 weighted
  }
  return score;
}

function normalApproxCI(p: number, n: number) {
  if (n <= 0) return [0, 0] as [number, number];
  const z = 1.96;
  const se = Math.sqrt((p * (1 - p)) / n);
  return [clamp01(p - z * se), clamp01(p + z * se)] as [number, number];
}

export default function App() {
  // ===== DEMO CONTENT =====
  const [question, setQuestion] = useState("Did Protocol Z’s token launch create sustainable value?");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([
    {
      id: 1,
      url: "On-chain analytics dashboard",
      snippet:
        "Active wallet addresses interacting with Protocol Z increased 220% in the 30 days post-launch, indicating rapid user adoption.",
      quality: 0.85
    },
    {
      id: 2,
      url: "DEX liquidity + price data",
      snippet: "Token price declined 48% from launch week highs, with liquidity incentives concentrated among early wallets.",
      quality: 0.8
    },
    {
      id: 3,
      url: "Audit summary",
      snippet: "No critical vulnerabilities, but economic design risks were flagged around emissions and yield sustainability.",
      quality: 0.7
    },
    {
      id: 4,
      url: "Governance forum snapshot",
      snippet: "Governance participation rose, but many proposals focus on incentive extensions rather than product improvements.",
      quality: 0.65
    },
    {
      id: 5,
      url: "Integration announcement",
      snippet: "Protocol Z integrated into two major DeFi aggregators, increasing composability and cross-protocol utility.",
      quality: 0.75
    },
    {
      id: 6,
      url: "DeFi research note",
      snippet: "APYs appear largely subsidy-driven; similar protocols saw user drop-offs after emissions tapered.",
      quality: 0.6
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
      { id: nextId, url: newUrl.trim(), snippet: newSnippet.trim(), quality: clamp01(newQuality) }
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

  // ===== RUN STATE =====
  const NUM_ITERATIONS = 50;
  const COMMITTEE_SIZE = 5;

  const archetypes = [
    { name: "Strict Empiricist", biasYes: +0.15, biasNull: -0.05 },
    { name: "Skeptic", biasYes: -0.10, biasNull: +0.20 },
    { name: "Quantifier", biasYes: +0.05, biasNull: -0.02 },
    { name: "Contrarian", biasYes: -0.15, biasNull: -0.05 },
    { name: "Source-Quality Hawk", biasYes: +0.05, biasNull: +0.05 },
    { name: "Consensus-Seeker", biasYes: +0.10, biasNull: -0.03 },
    { name: "Methodologist", biasYes: 0.0, biasNull: +0.10 }
  ];

  const [running, setRunning] = useState(false);
  const [iteration, setIteration] = useState(0);

  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [convergence, setConvergence] = useState<ConvergencePoint[]>([]);
  const [pYes, setPYes] = useState(0);
  const [pNo, setPNo] = useState(0);
  const [pNull, setPNull] = useState(0);
  const [ci95, setCi95] = useState<[number, number]>([0, 0]);

  const intervalRef = useRef<number | null>(null);

  function resetRun() {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    setRunning(false);
    setIteration(0);
    setBallots([]);
    setConvergence([]);
    setPYes(0);
    setPNo(0);
    setPNull(0);
    setCi95([0, 0]);
  }

  function pickEvidenceIds(maxCount: number) {
    const ids = evidence.map((e) => e.id);
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(maxCount, shuffled.length));
  }

  function startRun() {
    resetRun();
    setRunning(true);

    const signal = evidenceSignal(evidence); // -..+
    const baseYes = 0.25 + 0.5 * sigmoid(signal); // ~0.25..0.75

    let yesCount = 0;
    let noCount = 0;
    let nullCount = 0;

    let iter = 0;

    intervalRef.current = window.setInterval(() => {
      iter += 1;
      setIteration(iter);

      for (let k = 0; k < COMMITTEE_SIZE; k++) {
        const a = archetypes[Math.floor(Math.random() * archetypes.length)];

        let p_yes = clamp01(baseYes + a.biasYes);
        let p_null = clamp01(0.15 + a.biasNull);
        let p_no = clamp01(1 - p_yes - p_null);

        const s = p_yes + p_no + p_null;
        p_yes /= s;
        p_no /= s;
        p_null /= s;

        const r = Math.random();
        let vote: Vote = "NULL";
        if (r < p_yes) vote = "YES";
        else if (r < p_yes + p_no) vote = "NO";
        else vote = "NULL";

        if (vote === "YES") yesCount++;
        if (vote === "NO") noCount++;
        if (vote === "NULL") nullCount++;

        const supporting = vote === "YES" ? pickEvidenceIds(2) : pickEvidenceIds(1);
        const refuting = vote === "NO" ? pickEvidenceIds(2) : pickEvidenceIds(1);

        const avgQ = evidence.length ? evidence.reduce((acc, e) => acc + e.quality, 0) / evidence.length : 0.7;

        const ballot: Ballot = {
          iteration: iter,
          archetype: a.name,
          vote,
          supporting_evidence_ids: supporting,
          refuting_evidence_ids: refuting,
          rubric_scores: {
            evidence_quality: clamp01(avgQ + (Math.random() * 0.2 - 0.1)),
            claim_specificity: clamp01(0.6 + (Math.random() * 0.25 - 0.12)),
            source_reliability: clamp01(avgQ + (Math.random() * 0.2 - 0.1))
          },
          reasoning:
            vote === "NULL"
              ? "Evidence is mixed; insufficient to resolve confidently."
              : vote === "YES"
              ? "Weighted evidence suggests adoption and utility despite sustainability risks."
              : "Downside indicators and incentive sustainability concerns dominate."
        };

        setBallots((prev) => [...prev, ballot]);
      }

      const total = yesCount + noCount + nullCount;
      const curYes = total ? yesCount / total : 0;
      const curNo = total ? noCount / total : 0;
      const curNull = total ? nullCount / total : 0;

      setPYes(curYes);
      setPNo(curNo);
      setPNull(curNull);

      setConvergence((prev) => [...prev, { iteration: iter, p_yes: curYes, p_no: curNo, p_null: curNull }]);
      setCi95(normalApproxCI(curYes, total));

      if (iter >= NUM_ITERATIONS) {
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        intervalRef.current = null;
        setRunning(false);
      }
    }, 220);
  }

  // IMPORTANT: Run is clickable even if not frozen (for MVP).
  // Freeze is still shown as a "verifiability" story element.
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
            Run Monte Carlo Swarm
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
                  <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>q={e.quality.toFixed(2)}</span>
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
            Iteration {iteration}/{NUM_ITERATIONS} • Committee size {COMMITTEE_SIZE}
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

        <div style={{ marginTop: 12, opacity: 0.8, fontSize: 13 }}>
          95% CI for P(YES):{" "}
          <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
            [{(ci95[0] * 100).toFixed(1)}%, {(ci95[1] * 100).toFixed(1)}%]
          </span>
          <span style={{ marginLeft: 10, opacity: 0.7 }}>(normal approximation; demo)</span>
        </div>

        {/* Convergence mini-strip */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Convergence (P(YES) over iterations)</div>
          <div style={{ display: "flex", gap: 2, height: 36, alignItems: "flex-end" }}>
            {convergence.slice(-60).map((pt) => (
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
                  key={`${b.iteration}-${idx}`}
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
