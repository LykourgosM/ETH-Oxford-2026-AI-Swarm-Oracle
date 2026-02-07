"""FastAPI server — exposes the swarm as an API for the frontend."""
from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from swarm.mock_evidence import MOCK_BUNDLES
from swarm.runner import run_swarm, stream_swarm
from swarm.schemas import EvidenceBundle, VerdictDistribution

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
                yield f"event: verdict\ndata: {json.dumps(item.model_dump())}\n\n"
            else:
                yield f"event: snapshot\ndata: {json.dumps(item.model_dump())}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/mock-bundles")
async def get_mock_bundles() -> list[EvidenceBundle]:
    """Return mock evidence bundles for testing."""
    return MOCK_BUNDLES
