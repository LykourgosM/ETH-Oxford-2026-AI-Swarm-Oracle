import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

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

// Auto quality scorer (demo-only). In production, the backend computes this.
function autoQualityScore(urlOrLabel: string, snippet: string) {
  const text = `${urlOrLabel} ${snippet}`.toLowerCase();
  let q = 0.62;
  if (text.includes("audit")) q += 0.18;
  if (text.includes("dashboard") || text.includes("on-chain") || text.includes("analytics")) q += 0.12;
  if (text.includes("report") || text.includes("data") || text.includes("metrics")) q += 0.06;
  if (text.includes("transaction") || text.includes("addresses") || text.includes("tvl")) q += 0.05;
  if (text.includes("forum") || text.includes("snapshot") || text.includes("thread")) q -= 0.06;
  if (text.includes("rumor") || text.includes("anon") || text.includes("unverified")) q -= 0.12;
  if (snippet.trim().length >= 140) q += 0.04;
  return clamp01(q);
}

// ===== MOCK SIMULATION (no API calls, no tokens spent) =====
const MOCK_ARCHETYPES = ["strict_empiricist", "permissive_interpreter", "skeptic", "source_quality_hawk", "contrarian"];

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
      const ids = evidence.map((e) => e.id);

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
        reasoning:
          vote === "YES"
            ? "Evidence supports the claim."
            : vote === "NO"
              ? "Evidence contradicts the claim."
              : "Insufficient evidence to decide."
      });
    }

    const total = allBallots.length;
    const p_yes = allBallots.filter((b) => b.vote === "YES").length / total;
    const p_no = allBallots.filter((b) => b.vote === "NO").length / total;
    const p_null = allBallots.filter((b) => b.vote === "NULL").length / total;

    onSnapshot({ iteration: iter, p_yes, p_no, p_null });

    if (iter >= NUM_ITER) {
      clearInterval(interval);
      const z = 1.96;
      const seY = Math.sqrt((p_yes * (1 - p_yes)) / total);
      const seN = Math.sqrt((p_no * (1 - p_no)) / total);
      const seU = Math.sqrt((p_null * (1 - p_null)) / total);
      onVerdict({
        question,
        p_yes, p_no, p_null,
        num_iterations: NUM_ITER,
        committee_size: COMMITTEE,
        converged_at_iteration: null,
        credible_intervals_95: {
          YES: [clamp01(p_yes - z * seY), clamp01(p_yes + z * seY)],
          NO: [clamp01(p_no - z * seN), clamp01(p_no + z * seN)],
          NULL: [clamp01(p_null - z * seU), clamp01(p_null + z * seU)]
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

/** ===== "TECHY" UI THEME ===== */
const UI = {
  bg:
    "radial-gradient(1200px 800px at 18% 8%, rgba(99,102,241,0.22), transparent 55%), radial-gradient(900px 650px at 78% 18%, rgba(236,72,153,0.14), transparent 52%), radial-gradient(900px 650px at 72% 78%, rgba(34,197,94,0.12), transparent 50%), #050813",
  panel: "rgba(15, 23, 42, 0.62)",
  panel2: "rgba(2, 6, 23, 0.60)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderSoft: "1px solid rgba(255,255,255,0.08)",
  shadow: "0 20px 60px rgba(0,0,0,0.45)",
  glow: "0 0 0 1px rgba(99,102,241,0.25), 0 0 40px rgba(99,102,241,0.18)",
  text: "#E5E7EB",
  muted: "rgba(226,232,240,0.70)",
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
};

const s = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: UI.bg,
    color: UI.text,
    fontFamily: "system-ui",
    position: "relative",
    overflowX: "hidden"
  } as CSSProperties,

  grain: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none",
    zIndex: 5,
    opacity: 0.68,
    mixBlendMode: "soft-light",
    backgroundImage:
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23noise)' opacity='0.85'/%3E%3C/svg%3E")`,
    backgroundRepeat: "repeat",
    backgroundSize: "240px 240px",
    transform: "translateZ(0)"
  } as CSSProperties,

  vignette: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: "none",
    zIndex: 4,
    background:
      "radial-gradient(1200px 800px at 50% 20%, rgba(255,255,255,0.06), transparent 60%), radial-gradient(1200px 900px at 50% 90%, rgba(0,0,0,0.55), transparent 55%)",
    opacity: 0.65
  } as CSSProperties,

  shell: {
    width: "100%",
    maxWidth: "none",
    margin: "0 auto",
    padding: 28,
    boxSizing: "border-box"
  } as CSSProperties,

  card: {
    background: UI.panel,
    border: UI.border,
    borderRadius: 16,
    boxShadow: UI.shadow,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)"
  } as CSSProperties,

  cardInner: { padding: 18 } as CSSProperties,

  input: {
    padding: 10,
    borderRadius: 12,
    border: UI.borderSoft,
    background: UI.panel2,
    color: UI.text,
    outline: "none",
    boxSizing: "border-box"
  } as CSSProperties,

  textarea: {
    padding: 12,
    borderRadius: 12,
    border: UI.borderSoft,
    background: UI.panel2,
    color: UI.text,
    outline: "none",
    boxSizing: "border-box"
  } as CSSProperties,

  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(99,102,241,0.22)",
    color: UI.text,
    cursor: "pointer",
    fontWeight: 900,
    transition: "transform 120ms ease, background 120ms ease, border 120ms ease, opacity 120ms ease"
  } as CSSProperties,

  btnMuted: {
    background: "rgba(148,163,184,0.10)",
    border: "1px solid rgba(255,255,255,0.10)",
    fontWeight: 800
  } as CSSProperties,

  btnGreen: { background: "rgba(34,197,94,0.18)" } as CSSProperties,

  badge: {
    fontFamily: UI.mono,
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    border: UI.borderSoft,
    background: "rgba(255,255,255,0.06)",
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    color: "rgba(226,232,240,0.92)"
  } as CSSProperties,

  grid2: {
    display: "grid",
    gridTemplateColumns: "1.1fr 1fr",
    gap: 18,
    marginTop: 14
  } as CSSProperties,

  sectionTitle: {
    marginTop: 0,
    marginBottom: 10,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    opacity: 0.82,
    fontFamily: UI.mono
  } as CSSProperties,

  dot: (color: string) =>
    ({
      width: 8,
      height: 8,
      borderRadius: 999,
      background: color,
      boxShadow: `0 0 14px ${color}`,
      display: "inline-block"
    }) as CSSProperties,

  heroWrap: {
    height: "120vh",
    position: "relative"
  } as CSSProperties,

  heroSticky: {
    position: "sticky",
    top: 0,
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  } as CSSProperties,

  heroInner: {
    textAlign: "center",
    maxWidth: 980
  } as CSSProperties,

  heroH1: {
    margin: 0,
    fontWeight: 950,
    letterSpacing: 0.2,
    lineHeight: 0.98
  } as CSSProperties,

  heroSub: {
    margin: "10px 0 0 0",
    opacity: 0.72,
    fontSize: 14
  } as CSSProperties,

  heroHint: {
    position: "absolute",
    bottom: 22,
    left: "50%",
    transform: "translateX(-50%)",
    fontFamily: UI.mono,
    fontSize: 12,
    opacity: 0.65,
    display: "inline-flex",
    alignItems: "center",
    gap: 8
  } as CSSProperties,

  contentWrap: {
    paddingBottom: 36
  } as CSSProperties
};

function hoverLift(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "translateY(-1px)";
}
function hoverDrop(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.transform = "translateY(0px)";
}

function voteChip(v: Vote): CSSProperties {
  return {
    fontFamily: UI.mono,
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      v === "YES"
        ? "rgba(34,197,94,0.18)"
        : v === "NO"
          ? "rgba(239,68,68,0.18)"
          : "rgba(148,163,184,0.14)",
    color: "rgba(226,232,240,0.95)"
  };
}

export default function App() {
  // ===== Scroll-based hero growth =====
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY || 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const t = clamp01(scrollY / 520);
  const titleScale = 0.55 + 0.95 * t;
  const titleOpacity = 0.92 + 0.08 * t;
  const titleGlow = 0.12 + 0.28 * t;
  const titleY = 10 - 28 * t;
  const contentFade = clamp01((scrollY - 420) / 220);

  // ===== DEMO CONTENT =====
  const [question, setQuestion] = useState("Did Protocol Z's token launch create sustainable value?");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([
    {
      id: 1, url: "On-chain analytics dashboard",
      snippet: "Active wallet addresses interacting with Protocol Z increased 220% in the 30 days post-launch, indicating rapid user adoption.",
      quality_score: 0.85, timestamp: new Date().toISOString()
    },
    {
      id: 2, url: "DEX liquidity + price data",
      snippet: "Token price declined 48% from launch week highs, with liquidity incentives concentrated among early wallets.",
      quality_score: 0.8, timestamp: new Date().toISOString()
    },
    {
      id: 3, url: "Audit summary",
      snippet: "No critical vulnerabilities, but economic design risks were flagged around emissions and yield sustainability.",
      quality_score: 0.7, timestamp: new Date().toISOString()
    },
    {
      id: 4, url: "Governance forum snapshot",
      snippet: "Governance participation rose, but many proposals focus on incentive extensions rather than product improvements.",
      quality_score: 0.65, timestamp: new Date().toISOString()
    },
    {
      id: 5, url: "Integration announcement",
      snippet: "Protocol Z integrated into two major DeFi aggregators, increasing composability and cross-protocol utility.",
      quality_score: 0.75, timestamp: new Date().toISOString()
    },
    {
      id: 6, url: "DeFi research note",
      snippet: "APYs appear largely subsidy-driven; similar protocols saw user drop-offs after emissions tapered.",
      quality_score: 0.6, timestamp: new Date().toISOString()
    }
  ]);

  const [newUrl, setNewUrl] = useState("");
  const [newSnippet, setNewSnippet] = useState("");
  const [collectingEvidence, setCollectingEvidence] = useState(false);
  const hasDraftEvidence = newUrl.trim().length > 0 || newSnippet.trim().length > 0;

  const predictedQuality = useMemo(() => {
    if (!hasDraftEvidence) return 0;
    return autoQualityScore(newUrl.trim(), newSnippet.trim());
  }, [newUrl, newSnippet, hasDraftEvidence]);

  const predictedQualityLabel = hasDraftEvidence ? predictedQuality.toFixed(2) : "—";
  const predictedQualityBarPct = hasDraftEvidence ? Math.round(predictedQuality * 100) : 0;

  const [isFrozen, setIsFrozen] = useState(false);
  const merkleRoot = useMemo(() => fakeMerkleRoot(evidence, question), [evidence, question]);

  const addEvidence = () => {
    if (!newUrl.trim() || !newSnippet.trim()) return;
    const nextId = evidence.length ? Math.max(...evidence.map((e) => e.id)) + 1 : 1;
    const q = autoQualityScore(newUrl.trim(), newSnippet.trim());
    setEvidence([
      ...evidence,
      { id: nextId, url: newUrl.trim(), snippet: newSnippet.trim(), quality_score: q, timestamp: new Date().toISOString() }
    ]);
    setNewUrl("");
    setNewSnippet("");
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

  function applyVerdict(verdict: VerdictDistribution) {
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

  async function startRun() {
    resetRun();
    setRunning(true);

    if (useMock) {
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
          applyVerdict(verdict);
          setRunning(false);
        },
        question
      );
      return;
    }

    // Real API — first collect evidence via Tavily, then run swarm
    let bundle;
    try {
      setCollectingEvidence(true);
      const collectRes = await fetch(`${API_BASE}/collect-evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      if (!collectRes.ok) throw new Error(`Evidence collection failed: ${collectRes.status}`);
      bundle = await collectRes.json();
      setCollectingEvidence(false);
    } catch (err) {
      console.error("Evidence collection error:", err);
      setCollectingEvidence(false);
      setRunning(false);
      return;
    }

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
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (eventType === "snapshot") {
              const snap = data as ConvergencePoint;
              setIteration(snap.iteration);
              setPYes(snap.p_yes);
              setPNo(snap.p_no);
              setPNull(snap.p_null);
              setConvergence((prev) => [...prev, snap]);
            } else if (eventType === "verdict") {
              applyVerdict(data as VerdictDistribution);
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

  // ===== HEATMAP (Agent Type x Vote %) =====
  const voteHeatmap = useMemo(() => {
    const map: Record<string, { YES: number; NO: number; NULL: number; total: number }> = {};
    for (const b of ballots) {
      const a = b.archetype || "unknown";
      if (!map[a]) map[a] = { YES: 0, NO: 0, NULL: 0, total: 0 };
      map[a].total += 1;
      map[a][b.vote] += 1;
    }
    return Object.entries(map)
      .map(([archetype, c]) => ({
        archetype,
        total: c.total,
        yes: c.total ? c.YES / c.total : 0,
        no: c.total ? c.NO / c.total : 0,
        nul: c.total ? c.NULL / c.total : 0
      }))
      .sort((a, b) => b.total - a.total);
  }, [ballots]);

  function heatCellStyle(p: number): CSSProperties {
    const opacity = 0.10 + 0.70 * clamp01(p);
    return {
      background: `rgba(99, 102, 241, ${opacity})`,
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 12,
      padding: "8px 10px",
      fontFamily: UI.mono,
      fontSize: 12,
      color: "rgba(226,232,240,0.95)"
    };
  }

  return (
    <div style={s.page}>
      <div style={s.vignette} />
      <div style={s.grain} />

      <div style={s.shell}>
        {/* ===== HERO ===== */}
        <div style={s.heroWrap}>
          <div style={s.heroSticky}>
            <div style={s.heroInner}>
              <h1
                style={{
                  ...s.heroH1,
                  fontSize: 64,
                  transform: `translateY(${titleY}px) scale(${titleScale})`,
                  transformOrigin: "center",
                  opacity: titleOpacity,
                  textShadow: `0 0 ${18 + 30 * titleGlow}px rgba(99,102,241,${0.18 + 0.28 * titleGlow})`,
                  transition: "text-shadow 120ms ease"
                }}
              >
                Veritas Swarm
              </h1>
              <p style={s.heroSub}>Monte Carlo Committee Oracle</p>
            </div>
            <div style={s.heroHint}>
              <span style={{ opacity: 0.8 }}>scroll</span>
              <span style={{ transform: "translateY(-1px)" }}>&#8595;</span>
            </div>
          </div>
        </div>

        {/* ===== CONTENT ===== */}
        <div style={{ ...s.contentWrap, opacity: contentFade, transform: `translateY(${(1 - contentFade) * 10}px)` }}>
          {/* Status row */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <span style={s.badge}>
              <span style={s.dot(running ? "rgba(34,197,94,0.95)" : "rgba(148,163,184,0.9)")} />
              <span style={{ opacity: 0.9 }}>{collectingEvidence ? "Collecting" : running ? "Streaming" : iteration > 0 ? "Complete" : "Idle"}</span>
            </span>
            <span style={s.badge} title="Evidence commitment (demo)">
              <span style={{ opacity: 0.75 }}>Merkle</span>
              <span style={{ fontFamily: UI.mono }}>{merkleRoot.slice(0, 10)}…{merkleRoot.slice(-6)}</span>
            </span>
          </div>

          <div style={s.grid2}>
            {/* Left: Question */}
            <div style={s.card}>
              <div style={s.cardInner}>
                <div style={s.sectionTitle}>Question</div>
                <textarea
                  value={question}
                  onChange={(e) => { setQuestion(e.target.value); setIsFrozen(false); }}
                  placeholder="Enter a question for the swarm..."
                  data-gramm="false" data-gramm_editor="false" spellCheck={false}
                  style={{ ...s.textarea, width: "100%", height: 110, fontSize: 15, lineHeight: 1.35 }}
                />

                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                  <span style={{
                    ...s.badge,
                    background: isFrozen ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.06)",
                    border: isFrozen ? "1px solid rgba(16,185,129,0.25)" : UI.borderSoft,
                    color: isFrozen ? "rgba(52,211,153,0.95)" : "rgba(226,232,240,0.92)"
                  }}>
                    <span style={s.dot(isFrozen ? "rgba(34,197,94,0.95)" : "rgba(148,163,184,0.9)")} />
                    {isFrozen ? "Evidence Frozen" : "Not Frozen"}
                  </span>
                  <div style={{ marginLeft: "auto" }}>
                    <button onClick={() => setIsFrozen(true)} style={{ ...s.btn, background: isFrozen ? "rgba(16,185,129,0.18)" : "rgba(99,102,241,0.22)" }} onMouseEnter={hoverLift} onMouseLeave={hoverDrop}>
                      Freeze Evidence
                    </button>
                  </div>
                </div>

                {/* Mode Toggle */}
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: UI.borderSoft }}>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>Mode</span>
                  <button onClick={() => setUseMock(true)} style={{ ...s.btn, padding: "6px 10px", borderRadius: 10, background: useMock ? "rgba(234,179,8,0.22)" : "transparent", border: "1px solid rgba(255,255,255,0.12)", color: useMock ? "rgba(251,191,36,0.95)" : "rgba(148,163,184,0.9)", fontWeight: useMock ? 900 : 700 }} onMouseEnter={hoverLift} onMouseLeave={hoverDrop}>
                    Mock (free)
                  </button>
                  <button onClick={() => setUseMock(false)} style={{ ...s.btn, padding: "6px 10px", borderRadius: 10, background: !useMock ? "rgba(34,197,94,0.18)" : "transparent", border: "1px solid rgba(255,255,255,0.12)", color: !useMock ? "rgba(52,211,153,0.95)" : "rgba(148,163,184,0.9)", fontWeight: !useMock ? 900 : 700 }} onMouseEnter={hoverLift} onMouseLeave={hoverDrop}>
                    Live API
                  </button>
                </div>

                {/* Run / Reset */}
                <button disabled={runDisabled} onClick={startRun} style={{ ...s.btn, width: "100%", marginTop: 12, opacity: runDisabled ? 0.5 : 1, cursor: runDisabled ? "not-allowed" : "pointer", background: runDisabled ? "rgba(148,163,184,0.10)" : "rgba(99,102,241,0.30)", border: runDisabled ? UI.borderSoft : "1px solid rgba(99,102,241,0.30)" }}>
                  {collectingEvidence ? "Collecting Evidence..." : running ? "Running Swarm..." : "Run Monte Carlo Swarm"}
                </button>
                <button onClick={resetRun} style={{ ...s.btn, ...s.btnMuted, width: "100%", marginTop: 10 }} onMouseEnter={hoverLift} onMouseLeave={hoverDrop}>
                  Reset Run
                </button>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, lineHeight: 1.35 }}>
                  Any change to question/evidence automatically unfreezes the bundle.
                </div>
              </div>
            </div>

            {/* Right: Evidence Bundle */}
            <div style={s.card}>
              <div style={s.cardInner}>
                <div style={s.sectionTitle}>Evidence Bundle</div>

                <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                  <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Source URL (or label)" style={s.input} />
                  <textarea value={newSnippet} onChange={(e) => setNewSnippet(e.target.value)} placeholder="Snippet / excerpt (what the agent can cite)" data-gramm="false" data-gramm_editor="false" spellCheck={false} style={{ ...s.textarea, height: 78 }} />

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>Quality (auto)</span>
                    <div style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden", minWidth: 140, border: "1px solid rgba(255,255,255,0.08)" }} title={hasDraftEvidence ? predictedQuality.toFixed(2) : "Enter URL + snippet to estimate"}>
                      <div style={{ width: `${predictedQualityBarPct}%`, height: "100%", background: hasDraftEvidence ? "rgba(236,72,153,0.85)" : "rgba(148,163,184,0.20)" }} />
                    </div>
                    <span style={{ width: 52, textAlign: "right", fontFamily: UI.mono, opacity: 0.95 }}>{predictedQualityLabel}</span>
                    <button onClick={addEvidence} style={{ ...s.btn, ...s.btnGreen }} onMouseEnter={hoverLift} onMouseLeave={hoverDrop} title="Append evidence to the bundle">Add</button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {evidence.map((e) => (
                    <div key={e.id} style={{ padding: 12, borderRadius: 14, background: "rgba(2,6,23,0.40)", border: UI.borderSoft }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: UI.mono, fontSize: 12, padding: "4px 8px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(226,232,240,0.95)" }}>E{e.id}</span>
                        <span style={{ fontSize: 13, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.url}</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.85, fontFamily: UI.mono }}>q={e.quality_score.toFixed(2)}</span>
                        <button onClick={() => removeEvidence(e.id)} style={{ marginLeft: 6, border: "none", background: "transparent", color: "rgba(148,163,184,0.95)", cursor: "pointer", fontSize: 18, lineHeight: 1 }} title="Remove">×</button>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>{e.snippet}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ===== LIVE RUN PANEL ===== */}
          <div style={{ ...s.card, marginTop: 18 }}>
            <div style={s.cardInner}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={s.sectionTitle}>Live Resolution</div>
                <span style={{ opacity: 0.75, fontSize: 12 }}>
                  Iteration <span style={{ fontFamily: UI.mono }}>{iteration}</span>
                  {numIterations > 0 && <>/<span style={{ fontFamily: UI.mono }}>{numIterations}</span></>}
                  {committeeSize > 0 && <> • Committee <span style={{ fontFamily: UI.mono }}>{committeeSize}</span></>}
                </span>
                <span style={{ marginLeft: "auto", opacity: 0.8, fontSize: 12, display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span style={s.dot(running ? "rgba(34,197,94,0.95)" : iteration > 0 ? "rgba(99,102,241,0.95)" : "rgba(148,163,184,0.9)")} />
                  {running ? "Running…" : iteration > 0 ? "Complete" : "Idle"}
                </span>
              </div>

              {/* Probability bars */}
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 90px", gap: 12, marginTop: 12, alignItems: "center" }}>
                {[
                  { label: "P(YES)", v: pYes },
                  { label: "P(NO)", v: pNo },
                  { label: "P(NULL)", v: pNull }
                ].map((row) => (
                  <div key={row.label} style={{ display: "contents" }}>
                    <div style={{ opacity: 0.85, fontFamily: UI.mono }}>{row.label}</div>
                    <div style={{ height: 10, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ width: `${Math.round(row.v * 100)}%`, height: "100%", background: "rgba(99,102,241,0.78)" }} />
                    </div>
                    <div style={{ fontFamily: UI.mono, textAlign: "right", opacity: 0.95 }}>{(row.v * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>

              {/* Credible intervals */}
              <div style={{ marginTop: 12, opacity: 0.8, fontSize: 12, display: "grid", gap: 4 }}>
                <div style={{ fontFamily: UI.mono }}>95% Credible Intervals (Dirichlet posterior):</div>
                <div style={{ fontFamily: UI.mono, paddingLeft: 12 }}>
                  YES: [{(ci95.YES?.[0] * 100 || 0).toFixed(1)}%, {(ci95.YES?.[1] * 100 || 0).toFixed(1)}%]
                  {" "} NO: [{(ci95.NO?.[0] * 100 || 0).toFixed(1)}%, {(ci95.NO?.[1] * 100 || 0).toFixed(1)}%]
                  {" "} NULL: [{(ci95.NULL?.[0] * 100 || 0).toFixed(1)}%, {(ci95.NULL?.[1] * 100 || 0).toFixed(1)}%]
                </div>
              </div>

              {/* Statistics row */}
              <div style={{ marginTop: 12, display: "flex", gap: 20, fontSize: 12, opacity: 0.8, flexWrap: "wrap" }}>
                <span>
                  Fleiss' Kappa: <span style={{ fontFamily: UI.mono, fontWeight: 700 }}>{fleissKappa.toFixed(3)}</span>
                  <span style={{ opacity: 0.7, marginLeft: 4 }}>
                    ({fleissKappa < 0.2 ? "high subjectivity" : fleissKappa < 0.6 ? "moderate agreement" : "strong agreement"})
                  </span>
                </span>
                <span>
                  Effective N: <span style={{ fontFamily: UI.mono, fontWeight: 700 }}>{nEff.toFixed(1)}</span>
                  <span style={{ opacity: 0.7 }}> / {ballots.length} ballots</span>
                </span>
                {convergedAt && (
                  <span>
                    Converged at iteration <span style={{ fontFamily: UI.mono, fontWeight: 700 }}>{convergedAt}</span>
                  </span>
                )}
              </div>

              {/* Convergence mini-strip */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, fontFamily: UI.mono }}>Convergence: P(YES) per iteration</div>
                <div style={{ display: "flex", gap: 2, height: 36, alignItems: "flex-end" }}>
                  {convergence.map((pt) => (
                    <div key={pt.iteration} title={`iter ${pt.iteration}: ${(pt.p_yes * 100).toFixed(1)}%`} style={{ width: 6, height: `${Math.max(2, Math.round(pt.p_yes * 36))}px`, borderRadius: 3, background: "rgba(34,197,94,0.75)", opacity: 0.95 }} />
                  ))}
                </div>
              </div>

              {/* Ballot feed */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, fontFamily: UI.mono }}>Committee ballots (latest first)</div>
                <div style={{ maxHeight: 200, overflowY: "auto", borderRadius: 14, border: UI.borderSoft, background: "rgba(2,6,23,0.35)" }}>
                  {ballots.slice().reverse().slice(0, 80).map((b, idx) => (
                    <div key={`${b.iteration}-${b.archetype}-${idx}`} style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "90px 220px 86px 1fr", gap: 10, fontSize: 13, alignItems: "baseline" }}>
                      <span style={{ fontFamily: UI.mono, opacity: 0.85 }}>iter {b.iteration}</span>
                      <span style={{ opacity: 0.92 }}>{b.archetype}</span>
                      <span style={voteChip(b.vote)}>{b.vote}</span>
                      <span style={{ opacity: 0.75 }}>{b.reasoning}</span>
                    </div>
                  ))}
                  {ballots.length === 0 && (
                    <div style={{ padding: 12, opacity: 0.75, fontSize: 13 }}>Click <b>Run Monte Carlo Swarm</b> to stream ballots.</div>
                  )}
                </div>
              </div>

              {/* ===== HEATMAP ===== */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={s.sectionTitle}>Agent Vote Heatmap</div>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>% of each agent's votes (darker = higher share)</span>
                </div>

                <div style={{ marginTop: 8, borderRadius: 16, border: UI.borderSoft, overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 1fr 1fr 70px", gap: 10, padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 12, opacity: 0.85, fontFamily: UI.mono }}>
                    <div>Agent Type</div>
                    <div>YES</div>
                    <div>NO</div>
                    <div>NULL</div>
                    <div style={{ textAlign: "right" }}>n</div>
                  </div>

                  <div style={{ maxHeight: 260, overflowY: "auto" }}>
                    {voteHeatmap.length === 0 ? (
                      <div style={{ padding: 12, opacity: 0.75, fontSize: 13 }}>Run the swarm to populate the heatmap.</div>
                    ) : (
                      voteHeatmap.map((r) => (
                        <div key={r.archetype} style={{ display: "grid", gridTemplateColumns: "240px 1fr 1fr 1fr 70px", gap: 10, padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", alignItems: "center" }}>
                          <div style={{ fontWeight: 800, opacity: 0.95 }}>{r.archetype}</div>
                          <div style={heatCellStyle(r.yes)} title={`YES ${(r.yes * 100).toFixed(1)}%`}>{(r.yes * 100).toFixed(0)}%</div>
                          <div style={heatCellStyle(r.no)} title={`NO ${(r.no * 100).toFixed(1)}%`}>{(r.no * 100).toFixed(0)}%</div>
                          <div style={heatCellStyle(r.nul)} title={`NULL ${(r.nul * 100).toFixed(1)}%`}>{(r.nul * 100).toFixed(0)}%</div>
                          <div style={{ textAlign: "right", opacity: 0.7, fontFamily: UI.mono }}>{r.total}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
