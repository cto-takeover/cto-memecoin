#!/usr/bin/env bash
# Broadcast a signed transaction saved by near-cli-rs `save-to-file` with a raw
# `send_tx` JSON-RPC call, and print NEAR's response unedited.
# Usage: spike/send-raw.sh spike/tx-k1-ping.json
set -euo pipefail
RPC="${RPC:-https://rpc.testnet.near.org}"
TX=$(jq -r .signed_transaction_as_base64 "$1")
curl -s "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"spike\",\"method\":\"send_tx\",\"params\":{\"signed_tx_base64\":\"$TX\",\"wait_until\":\"FINAL\"}}" | jq .
