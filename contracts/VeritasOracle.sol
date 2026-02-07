// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VeritasOracle {
    struct Verdict {
        bytes32 questionHash;
        bytes32 merkleRoot;
        uint256 pYes;      // scaled by 1e18
        uint256 pNo;        // scaled by 1e18
        uint256 pNull;      // scaled by 1e18
        uint256 fleissKappa; // scaled by 1e18
        uint256 timestamp;
    }

    Verdict[] public verdicts;
    address public owner;

    event VerdictPosted(
        uint256 indexed id,
        bytes32 questionHash,
        bytes32 merkleRoot,
        uint256 pYes,
        uint256 pNo,
        uint256 pNull,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function postVerdict(
        bytes32 _questionHash,
        bytes32 _merkleRoot,
        uint256 _pYes,
        uint256 _pNo,
        uint256 _pNull,
        uint256 _fleissKappa
    ) external onlyOwner returns (uint256) {
        uint256 id = verdicts.length;
        verdicts.push(Verdict({
            questionHash: _questionHash,
            merkleRoot: _merkleRoot,
            pYes: _pYes,
            pNo: _pNo,
            pNull: _pNull,
            fleissKappa: _fleissKappa,
            timestamp: block.timestamp
        }));

        emit VerdictPosted(id, _questionHash, _merkleRoot, _pYes, _pNo, _pNull, block.timestamp);
        return id;
    }

    function getVerdict(uint256 _id) external view returns (Verdict memory) {
        return verdicts[_id];
    }

    function verdictCount() external view returns (uint256) {
        return verdicts.length;
    }
}
