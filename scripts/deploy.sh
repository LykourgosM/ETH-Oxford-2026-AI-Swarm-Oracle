#!/bin/bash
# Deploy VeritasOracle to Sepolia testnet
# Prerequisites: DEPLOYER_PRIVATE_KEY and SEPOLIA_RPC_URL in .env

set -e
source .env

echo "Deploying VeritasOracle to Sepolia..."

forge create contracts/VeritasOracle.sol:VeritasOracle \
  --rpc-url "${SEPOLIA_RPC_URL:-https://rpc.sepolia.org}" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

echo "Done! Copy the 'Deployed to' address into .env as CONTRACT_ADDRESS"
