# Spec 0 gate test: commands to run

This runbook tests a throwaway spike contract on `cto-spike.testnet`. The spike proves the two NEAR features that CTO needs, before work on the real contract starts. It is for the human who holds the testnet keys.

> **Note:** The gate test passed on Nov 10. Keep this file as a record and as a reference for the pre-sign method.

- Run each block from the **repo root**, in order.
- Time box: 2 hours.
- The commands work with **near-cli-rs 0.31.1** and **cargo-near 0.23.0**.
- Keys stay in `~/.near-credentials/` and `spike/keys/`. Both are outside git (`spike/keys/` is in `.gitignore`).

## Do a local dry run (no keys)

The sandbox test `spike/tests/gate_a.rs` runs each Gate A step on a local NEAR node:

```bash
(cd spike && cargo near build non-reproducible-wasm && cargo test -- --nocapture)
```

The dry run passed on Nov 10:

- Step 3 logged `ping by <K1>`.
- The pre-signed K1 transaction returned `InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound`.
- Step 6 logged `ping by <K2>`.
- Step 7 returned `MethodNameMismatch {"method_name":"set_face"}`.

The dry run does not replace the gate. Testnet is the real gate.

## Set up the tools (one time)

```bash
# Tools, if missing: Rust (rustup), cargo-near, near-cli-rs, jq
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
. ~/.cargo/env

# Fill in your own browser-wallet testnet account (MyNearWallet or Meteor). Gate B sends spike tokens there.
export WALLET=<your-wallet>.testnet
# Any account in your CLI keychain; it pays gas for swap and set_face (anyone may call them in the spike).
export CALLER=ani-cto.testnet
export RPC=https://rpc.testnet.near.org
```

If you do not have a browser-wallet testnet account, create one at https://testnet.mynearwallet.com before you start.

## Step 0: Create the accounts (5 minutes)

```bash
for a in cto demo-cto ani-cto budi-cto cto-spike; do
  near account create-account sponsor-by-faucet-service $a.testnet \
    autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
done
ls ~/.near-credentials/testnet/
near account view-account-summary cto-spike.testnet network-config testnet now
```

The five names were free on Nov 10, at about 18:45 WIB. If the faucet rate-limits you, wait one minute. Then run the command again for the missing names.

> **Caution:** Back up `~/.near-credentials/testnet/`. You need these full-access keys until deploy day.

## Gate A: the contract swaps its own keys

### A1. Build, deploy, generate K1 and K2

```bash
(cd spike && cargo near build non-reproducible-wasm)

near contract deploy cto-spike.testnet use-file spike/target/near/cto_spike.wasm \
  with-init-call new json-args "{\"holder\":\"$WALLET\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

mkdir -p spike/keys/k1 spike/keys/k2
near account create-account fund-later use-auto-generation save-to-folder spike/keys/k1
near account create-account fund-later use-auto-generation save-to-folder spike/keys/k2
mv spike/keys/k1/*.json spike/keys/k1.json && mv spike/keys/k2/*.json spike/keys/k2.json
export K1=$(jq -r .public_key spike/keys/k1.json) K2=$(jq -r .public_key spike/keys/k2.json)
echo "K1=$K1"; echo "K2=$K2"
```

The key files hold throwaway keys only. The `fund-later` command makes a key pair on your machine. It sends nothing to the chain.

### A2. `swap(K1)` from your own account

```bash
near contract call-function as-transaction cto-spike.testnet swap \
  json-args "{\"new_pk\":\"$K1\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as $CALLER network-config testnet sign-with-legacy-keychain send

near account list-keys cto-spike.testnet network-config testnet now
```

Expected: the log `swap: adding <K1> (ping only, 0.25 NEAR allowance)`. The key list shows K1 as a function-call key with these values: receiver `cto-spike.testnet`, method `ping`, allowance 0.25 NEAR.

### A3. `ping` signed as `cto-spike.testnet` with K1 → must succeed

```bash
near contract call-function as-transaction cto-spike.testnet ping json-args '{}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as cto-spike.testnet network-config testnet sign-with-access-key-file spike/keys/k1.json send
```

Expected: success, log `ping by <K1>`.

### A4. Pre-sign a K1 ping, then `swap(K2)`

The pre-signed ping acts as the old CEO's wallet. That wallet signs before it knows that its key is gone. For the reason, see [Why pre-sign](#why-pre-sign-matters-for-specs-24).

```bash
# Sign now while K1 still exists; this saves the transaction and does NOT send it
near contract call-function as-transaction cto-spike.testnet ping json-args '{}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as cto-spike.testnet network-config testnet sign-with-access-key-file spike/keys/k1.json \
  save-to-file spike/tx-k1-ping.json

near contract call-function as-transaction cto-spike.testnet swap \
  json-args "{\"new_pk\":\"$K2\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as $CALLER network-config testnet sign-with-legacy-keychain send

near account list-keys cto-spike.testnet network-config testnet now
```

Expected: the logs `swap: deleting <K1>` and `swap: adding <K2> …`. The key list shows K2 and no K1.

> **Caution:** Do A5 within a few hours. The block hash in the saved transaction expires after about one day.

### A5. K1 ping → must fail with `AccessKeyNotFound`

```bash
spike/send-raw.sh spike/tx-k1-ping.json
```

Expected (NEAR's response, unedited):

```
"InvalidTxError": { "InvalidAccessKeyError": { "AccessKeyNotFound": { "account_id": "cto-spike.testnet", "public_key": "<K1>" } } }
```

Optional comparison: send a new K1 ping the normal way. This ping never gets to NEAR. The CLI stops it first, with `access key <K1> does not exist while viewing`:

```bash
near contract call-function as-transaction cto-spike.testnet ping json-args '{}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as cto-spike.testnet network-config testnet sign-with-access-key-file spike/keys/k1.json send
```

### A6. K2 ping → must succeed

```bash
near contract call-function as-transaction cto-spike.testnet ping json-args '{}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as cto-spike.testnet network-config testnet sign-with-access-key-file spike/keys/k2.json send
```

Expected: success, log `ping by <K2>`.

### A7. Any other method with K2 → must fail with `MethodNameMismatch`

```bash
near contract call-function as-transaction cto-spike.testnet set_face json-args '{"face_id":2626}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as cto-spike.testnet network-config testnet sign-with-access-key-file spike/keys/k2.json \
  save-to-file spike/tx-k2-setface.json
spike/send-raw.sh spike/tx-k2-setface.json
```

Expected: `"InvalidAccessKeyError": { "MethodNameMismatch": { "method_name": "set_face" } }`.

**Gate A passes** if all of these are true:

- A3 and A6 succeed.
- A5 returns `AccessKeyNotFound`.
- A7 returns `MethodNameMismatch`.

## Gate B: a changed coin picture shows somewhere a judge can see

The deploy in A1 minted all 1,000,000 CTOSPIKE to `$WALLET`. The icon is the launch face, id 9: Highlighter background, Dots eyes, Flat mouth.

### B1. Record where the icon shows now

```bash
near tokens $WALLET view-ft-balance cto-spike.testnet network-config testnet now
near contract call-function as-read-only cto-spike.testnet get_face json-args '{}' network-config testnet now
```

Look at each of these places. Record if it shows a yellow face:

- Explorer token page: https://testnet.nearblocks.io/token/cto-spike.testnet
- Explorer holder page: `https://testnet.nearblocks.io/address/$WALLET` (tokens list)
- MyNearWallet: https://testnet.mynearwallet.com (sign in as `$WALLET`; you may need to add the token `cto-spike.testnet`)
- Meteor: https://wallet.meteorwallet.app (switch to testnet)

### B2. Change to a very different face

Face 3172 has a Parang stripe background, Laser eyes, Tongue mouth and a Top hat.

```bash
near contract call-function as-transaction cto-spike.testnet set_face json-args '{"face_id":3172}' \
  prepaid-gas '10 Tgas' attached-deposit '0 NEAR' \
  sign-as $CALLER network-config testnet sign-with-legacy-keychain send
near contract call-function as-read-only cto-spike.testnet get_face json-args '{}' network-config testnet now
```

Expected: `{"id":3172,"parts":[6,1,4,3]}`. `ft_metadata().icon` now encodes that face. The unit test `icon_follows_face` checks this.

### B3. Look at each place again

Look after 1 minute, after 10 minutes, and after a hard refresh.

**Gate B passes** if at least one place a judge would look shows the new face within 10 minutes.

## Report the results

Copy this table into your reply or into `specs/00-gate-test.md`. Add the A5 and A7 output:

| Gate | Result | Notes | Date |
| --- | --- | --- | --- |
| A: key swap | pass / fail | A3: · A5: · A6: · A7: | |
| B: picture visible | pass / fail | explorer: · MyNearWallet: · Meteor: | |

## Why pre-sign (matters for specs 2–4)

The RPC cannot find a deleted key. A client that asks the RPC for the key's nonce before it signs fails on its own side. near-cli-rs, near-api, and near-api-js all do this. The error is `does not exist while viewing`, and the transaction never gets to NEAR.

To get NEAR's own `AccessKeyNotFound`, the client must sign without that lookup and then send the transaction. The client can use a cached or explicit nonce with a new block hash. The block hash lookup does not need the key. The dry run shows that the node then rejects the transaction with `AccessKeyNotFound`.

These three parts must all sign this way:

- The relayer's `/announce` (spec 3).
- The browser's "Try posting as" (spec 2).
- The `verify` check (spec 4).
