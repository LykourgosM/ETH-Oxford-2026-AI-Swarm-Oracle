from swarm.schemas import EvidenceBundle, EvidenceItem

MOCK_BUNDLES: list[EvidenceBundle] = [
    # ── Bundle 1: clear-cut YES case ────────────────────────────────
    EvidenceBundle(
        question="Did Uniswap v4 launch on Ethereum mainnet before January 2026?",
        rubric=["evidence_quality", "claim_specificity", "source_reliability"],
        evidence=[
            EvidenceItem(
                id=1,
                url="https://blog.uniswap.org/uniswap-v4-mainnet",
                snippet="Uniswap v4 officially deployed to Ethereum mainnet on 2025-10-15, introducing singleton pool architecture and hook contracts.",
                timestamp="2025-10-15T09:00:00Z",
                quality_score=0.95,
            ),
            EvidenceItem(
                id=2,
                url="https://etherscan.io/address/0xuniv4poolmanager",
                snippet="Contract creation transaction confirmed in block 18,942,301. Verified source code matches Uniswap v4 PoolManager.",
                timestamp="2025-10-15T09:12:00Z",
                quality_score=0.99,
            ),
            EvidenceItem(
                id=3,
                url="https://twitter.com/haabordeaux/status/example",
                snippet="Unconfirmed rumour that Uniswap v4 was actually a soft launch and full features won't be ready until March 2026.",
                timestamp="2025-10-20T14:00:00Z",
                quality_score=0.15,
            ),
        ],
        merkle_root="0xabc123def456789",
    ),

    # ── Bundle 2: ambiguous / contested case ────────────────────────
    EvidenceBundle(
        question="Has Ethereum layer-2 activity surpassed layer-1 activity by total transaction count?",
        rubric=["evidence_quality", "claim_specificity", "source_reliability"],
        evidence=[
            EvidenceItem(
                id=1,
                url="https://l2beat.com/scaling/summary",
                snippet="Combined L2 TPS reached 158 vs mainnet 14 TPS as of 2025-12-01. However, many L2 transactions are low-value bot activity.",
                timestamp="2025-12-01T00:00:00Z",
                quality_score=0.90,
            ),
            EvidenceItem(
                id=2,
                url="https://dune.com/queries/example",
                snippet="When filtering for transactions above $1 in value, L2 activity is only 2.3x mainnet, not the 10x headline figure.",
                timestamp="2025-12-05T00:00:00Z",
                quality_score=0.80,
            ),
            EvidenceItem(
                id=3,
                url="https://ethereum.org/en/layer-2/",
                snippet="The Ethereum Foundation considers rollup activity as part of the Ethereum ecosystem, but does not officially equate L2 tx count with L1 tx count.",
                timestamp="2025-11-20T00:00:00Z",
                quality_score=0.85,
            ),
            EvidenceItem(
                id=4,
                url="https://reddit.com/r/ethereum/comments/example",
                snippet="User analysis claims L2 stats are inflated by airdrop farming bots. Methodology disputed in comments.",
                timestamp="2025-12-10T00:00:00Z",
                quality_score=0.30,
            ),
        ],
        merkle_root="0xdef789abc123456",
    ),

    # ── Bundle 3: likely NO case ────────────────────────────────────
    EvidenceBundle(
        question="Did the Ethereum Foundation mass-sell ETH causing the Q3 2025 price crash?",
        rubric=["evidence_quality", "claim_specificity", "source_reliability"],
        evidence=[
            EvidenceItem(
                id=1,
                url="https://etherscan.io/address/0xef-foundation",
                snippet="EF wallet transferred 35,000 ETH to exchanges between July-September 2025, representing 0.03% of daily trading volume.",
                timestamp="2025-10-01T00:00:00Z",
                quality_score=0.92,
            ),
            EvidenceItem(
                id=2,
                url="https://www.coingecko.com/en/coins/ethereum",
                snippet="ETH price dropped 38% in Q3 2025, correlating with broader macro risk-off driven by rising US treasury yields.",
                timestamp="2025-10-01T00:00:00Z",
                quality_score=0.88,
            ),
            EvidenceItem(
                id=3,
                url="https://twitter.com/cryptoinfluencer/status/example",
                snippet="EF is dumping on retail AGAIN. This is why ETH can't hold $2k. They sold 100k ETH last month!!",
                timestamp="2025-09-15T00:00:00Z",
                quality_score=0.10,
            ),
            EvidenceItem(
                id=4,
                url="https://blog.ethereum.org/2025/09/treasury",
                snippet="Quarterly treasury report: EF sold 35,000 ETH for operational funding, consistent with prior quarters. Total holdings remain at 270,000 ETH.",
                timestamp="2025-09-30T00:00:00Z",
                quality_score=0.95,
            ),
        ],
        merkle_root="0x789456abc123def",
    ),
]
