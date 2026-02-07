"""Post oracle verdicts on-chain via the VeritasOracle contract."""
from __future__ import annotations

import hashlib
import json
import logging
import os

from dotenv import load_dotenv
from web3 import Web3

from swarm.schemas import VerdictDistribution

load_dotenv()
logger = logging.getLogger(__name__)

# ABI — functions + events we use
CONTRACT_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "id", "type": "uint256"},
            {"indexed": False, "name": "questionHash", "type": "bytes32"},
            {"indexed": False, "name": "merkleRoot", "type": "bytes32"},
            {"indexed": False, "name": "pYes", "type": "uint256"},
            {"indexed": False, "name": "pNo", "type": "uint256"},
            {"indexed": False, "name": "pNull", "type": "uint256"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "VerdictPosted",
        "type": "event",
    },
    {
        "inputs": [
            {"name": "_questionHash", "type": "bytes32"},
            {"name": "_merkleRoot", "type": "bytes32"},
            {"name": "_pYes", "type": "uint256"},
            {"name": "_pNo", "type": "uint256"},
            {"name": "_pNull", "type": "uint256"},
            {"name": "_fleissKappa", "type": "uint256"},
        ],
        "name": "postVerdict",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "_id", "type": "uint256"}],
        "name": "getVerdict",
        "outputs": [
            {
                "components": [
                    {"name": "questionHash", "type": "bytes32"},
                    {"name": "merkleRoot", "type": "bytes32"},
                    {"name": "pYes", "type": "uint256"},
                    {"name": "pNo", "type": "uint256"},
                    {"name": "pNull", "type": "uint256"},
                    {"name": "fleissKappa", "type": "uint256"},
                    {"name": "timestamp", "type": "uint256"},
                ],
                "name": "",
                "type": "tuple",
            }
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "verdictCount",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def _to_uint256(value: float) -> int:
    """Convert a float (0-1) to uint256 scaled by 1e18."""
    return int(value * 10**18)


def _to_bytes32(hex_str: str) -> bytes:
    """Convert a hex string (with or without 0x prefix) to bytes32."""
    clean = hex_str.replace("0x", "")
    return bytes.fromhex(clean.zfill(64))


def _get_contract():
    """Initialize web3 and return the contract instance."""
    rpc_url = os.environ.get("SEPOLIA_RPC_URL", "https://rpc.sepolia.org")
    contract_address = os.environ.get("CONTRACT_ADDRESS")
    if not contract_address:
        raise RuntimeError("CONTRACT_ADDRESS not set in .env")

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(contract_address),
        abi=CONTRACT_ABI,
    )
    return w3, contract


# ---- In-memory verdict cache ----
_verdict_cache: list[dict] = []
_cache_loaded = False


def _read_verdict(contract, i: int) -> dict:
    """Read a single verdict from the contract."""
    v = contract.functions.getVerdict(i).call()
    return {
        "verdict_id": i,
        "question_hash": "0x" + v[0].hex(),
        "merkle_root": "0x" + v[1].hex(),
        "p_yes": v[2] / 10**18,
        "p_no": v[3] / 10**18,
        "p_null": v[4] / 10**18,
        "fleiss_kappa": v[5] / 10**18,
        "timestamp": v[6],
    }


def post_verdict(question: str, merkle_root: str, verdict: VerdictDistribution) -> dict:
    """Post a verdict on-chain. Returns tx hash and verdict ID."""
    global _verdict_cache, _cache_loaded

    private_key = os.environ.get("DEPLOYER_PRIVATE_KEY")
    if not private_key:
        raise RuntimeError("DEPLOYER_PRIVATE_KEY not set in .env")

    w3, contract = _get_contract()
    account = w3.eth.account.from_key(private_key)

    question_hash = hashlib.sha256(question.encode()).hexdigest()

    tx = contract.functions.postVerdict(
        _to_bytes32(question_hash),
        _to_bytes32(merkle_root),
        _to_uint256(verdict.p_yes),
        _to_uint256(verdict.p_no),
        _to_uint256(verdict.p_null),
        _to_uint256(max(0, verdict.fleiss_kappa)),  # kappa can be negative
    ).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })

    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

    verdict_id = contract.functions.verdictCount().call() - 1

    logger.info("Verdict posted on-chain: tx=%s, id=%d", tx_hash.hex(), verdict_id)

    result = {
        "tx_hash": tx_hash.hex(),
        "verdict_id": verdict_id,
        "block_number": receipt.blockNumber,
    }

    # Update cache immediately with the new verdict
    cached = {
        **result,
        "question_hash": "0x" + question_hash,
        "merkle_root": merkle_root,
        "p_yes": verdict.p_yes,
        "p_no": verdict.p_no,
        "p_null": verdict.p_null,
        "fleiss_kappa": max(0, verdict.fleiss_kappa),
        "timestamp": int(receipt.blockNumber),  # approximate
    }
    _verdict_cache.append(cached)

    return result


def get_all_verdicts() -> list[dict]:
    """Return cached verdicts, only hitting the chain on first call or when count grows."""
    global _verdict_cache, _cache_loaded

    try:
        w3, contract = _get_contract()
    except RuntimeError:
        return _verdict_cache

    on_chain_count = contract.functions.verdictCount().call()
    cached_count = len(_verdict_cache)

    if on_chain_count == 0:
        return []

    # Only fetch verdicts we haven't cached yet
    if cached_count < on_chain_count:
        for i in range(cached_count, on_chain_count):
            _verdict_cache.append(_read_verdict(contract, i))

    _cache_loaded = True
    return _verdict_cache
