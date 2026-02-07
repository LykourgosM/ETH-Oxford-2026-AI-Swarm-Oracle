"""FastAPI server — exposes the swarm as an API for the frontend."""
from __future__ import annotations

import json
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pydantic import BaseModel

from evidence.pipeline import build_evidence_bundle
from swarm.mock_evidence import MOCK_BUNDLES
from swarm.runner import run_swarm, stream_swarm
from swarm.schemas import EvidenceBundle, VerdictDistribution

logger = logging.getLogger(__name__)

app = FastAPI(title="Veritas Swarm API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/evaluate", response_model=VerdictDistribution)
async def evaluate(bundle: EvidenceBundle) -> VerdictDistribution:
    """Run the swarm and return the final verdict distribution."""
    return await run_swarm(bundle)


@app.post("/evaluate/stream")
async def evaluate_stream(bundle: EvidenceBundle) -> StreamingResponse:
    """Stream convergence snapshots as SSE, then the final verdict."""

    async def event_generator():
        async for item in stream_swarm(bundle):
            if isinstance(item, VerdictDistribution):
                # Post on-chain if configured
                onchain_result = None
                if os.environ.get("CONTRACT_ADDRESS"):
                    try:
                        from swarm.onchain import post_verdict
                        onchain_result = post_verdict(bundle.question, bundle.merkle_root, item)
                    except Exception:
                        logger.exception("Failed to post verdict on-chain")

                verdict_data = item.model_dump()
                if onchain_result:
                    verdict_data["onchain"] = onchain_result

                yield f"event: verdict\ndata: {json.dumps(verdict_data)}\n\n"
            else:
                yield f"event: snapshot\ndata: {json.dumps(item.model_dump())}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/mock-bundles")
async def get_mock_bundles() -> list[EvidenceBundle]:
    """Return mock evidence bundles for testing."""
    return MOCK_BUNDLES


class QuestionRequest(BaseModel):
    question: str


@app.post("/collect-evidence", response_model=EvidenceBundle)
async def collect_evidence(req: QuestionRequest) -> EvidenceBundle:
    """Run the evidence pipeline: question → search → score → hash → EvidenceBundle."""
    return await build_evidence_bundle(req.question)


@app.get("/verdicts")
async def get_verdicts() -> list[dict]:
    """Return all past on-chain verdicts by reading contract events."""
    try:
        from swarm.onchain import get_all_verdicts
        return get_all_verdicts()
    except Exception:
        logger.exception("Failed to read on-chain verdicts")
        return []
