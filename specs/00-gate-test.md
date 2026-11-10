# Spec 0: Gate test (run first)

Before any real code, prove the two NEAR tricks CTO depends on with a throwaway contract. Time box: 2 hours. The contract spec stays a draft until both results are recorded below.

**Agent:** write `spike/` (Rust, near-sdk 5.x) and a `spike/RUN.md` with exact copy-paste commands (near-cli-rs, testnet) for every step. **Human:** runs the commands with their keys and reports results.

## Step 0: hold the names (5 minutes, human)

Checked on testnet Nov 10, 14:30 WIB: `cto.testnet`, `demo-cto.testnet`, `ani-cto.testnet`, `budi-cto.testnet`, `cto-spike.testnet` were free; `cto-demo.testnet` is taken by someone else. Create the five accounts now (testnet faucet sponsor) and keep their full-access keys until deploy day.

## Gate A: the contract swaps its own keys

Spike contract on `cto-spike.testnet`, about 40 lines:

- `swap(new_pk: PublicKey)`: one batch on its own account: `DeleteKey(stored key)` if one is stored, then add `new_pk` as a function-call key with receiver = itself, method `ping`, allowance 0.25 NEAR; store `new_pk`.
- `ping()`: require `predecessor_account_id == current_account_id`; log `ping by {signer_account_pk}`.

Steps:

1. Deploy; generate keys K1 and K2 locally.
2. Call `swap(K1)` from the human's own account.
3. Sign `ping` as `cto-spike.testnet` with K1 → must succeed.
4. Call `swap(K2)`.
5. Sign `ping` with K1 → must fail with `AccessKeyNotFound`.
6. Sign `ping` with K2 → must succeed.
7. Sign any other method with K2 → must fail with `MethodNameMismatch`.

**Pass:** steps 3, 5, 6, 7 behave as stated. **Fail fallback:** `announce` instead requires `predecessor_account_id == seat.ceo` (the CEO calls with their own account). The demo still works, but the "locked out by NEAR itself" claim goes; update specs 1–4 accordingly (no voice key, no key swap, rejection becomes a contract panic `CTO: only the current CEO can announce`).

## Gate B: a changed coin picture shows somewhere a judge can see

Add to the spike a minimal NEP-141/148 token: `ft_metadata()` returns an icon built from a stored face number (use `reference/faces/faces.py` output), `set_face(n)` changes it (spike only, anyone may call).

1. Send some spike tokens to the human's wallet account.
2. Note where the icon shows: testnet explorer token page, MyNearWallet, Meteor.
3. Call `set_face` with a very different face.
4. Check each place after 1 minute, 10 minutes and a hard refresh.

**Pass:** at least one place a judge would look shows the new face within 10 minutes. **Fail:** keep CTO anyway. Our own pages always render the live face from `ft_metadata`; the README states plainly that wallets may cache icons, and the on-chain face history (`get_history`) is the proof.

## Results (human fills in)

| Gate | Result | Notes | Date |
| --- | --- | --- | --- |
| A: key swap | **pass** | testnet, `cto-spike.testnet`. A3 ping K1 ok (tx 2uPXmLTmCttNmPqKSpRwTTdEQivTZCPUYfHiQSBS845f); swap K1→K2 in one batch (tx CZZHXSYZ7z6CgrGKTZ5QoDotarhVXsdB3CZUpJuKDZ11); A5 pre-signed K1 ping → `InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound` (`spike/result-a5.json`); A6 ping K2 ok (tx D3PzBj3LJNRn44LaRAB4ScRX2Dhv9wQNk22TYDafvMFk); A7 `set_face` with K2 → `MethodNameMismatch` (`spike/result-a7.json`). Note: the old key's tx must be signed without a nonce lookup, else the client fails first with "does not exist while viewing" (see `spike/RUN.md`). | Nov 10, 2026 |
| B: picture visible | **fail → fallback applies** (keep CTO; our pages render the live face from `ft_metadata`; README says wallets and explorers cache icons; `get_history` is the proof) | explorer: **stale**. nearblocks (testnet API v3, `/v3/fts/cto-spike.testnet`) showed launch face 9 at 18:54 WIB; `set_face(3172)` at 18:54:23 WIB (tx F7YgtqGric4xfok7vk9A5Nv4fDNPZmBWrn3VhASwj5Ps) changed `ft_metadata` on chain immediately, but the explorer still served face 9 at every check through 19:06:53 WIB and again at 19:39 WIB (`spike/result-b-explorer.log`, times there are UTC+8). · Meteor (`0xc1d.testnet`, 100,000 CTOSPIKE sent 19:39 WIB, tx EoaAywWzWojhTzJDmSFq2QToQr5HH2Zj4vah26GAjFDa): first view showed the current face 3172 (round 1). Round 2: `set_face(643)` at 20:01:20 WIB (tx 67AParaAEPGrCnWoSE799NG6PNkjBBLZ5BKyMpbSGtDB); Meteor at 20:13–20:14 WIB (+12 min, after tapping Refresh; home and Send screens) still showed the old face 3172 while the chain served 643: Meteor reads the icon once and caches it. Explorer still on face 9 at 20:14 WIB (80 min after the first change) · MyNearWallet: not checked | Nov 10, 2026 |
