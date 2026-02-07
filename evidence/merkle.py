"""Merkle tree hashing for evidence bundles."""
from __future__ import annotations

import hashlib
import json


def hash_evidence(item: dict) -> str:
    """SHA-256 hash of a single evidence item (deterministic via sort_keys)."""
    return hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()


def merkle_root(hashes: list[str]) -> str:
    """Compute the Merkle root from a list of leaf hashes."""
    if not hashes:
        return "0x" + "0" * 64
    while len(hashes) > 1:
        if len(hashes) % 2 == 1:
            hashes.append(hashes[-1])  # duplicate last if odd
        hashes = [
            hashlib.sha256((hashes[i] + hashes[i + 1]).encode()).hexdigest()
            for i in range(0, len(hashes), 2)
        ]
    return "0x" + hashes[0]
