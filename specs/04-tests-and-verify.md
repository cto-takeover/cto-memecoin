# Spec 4: Tests (unit, integration, end-to-end) and `npm run verify`

All three kinds are covered, in six layers. None needs a key. `npm run verify` runs the keyless layers judges care about; GitHub Actions runs all six on every push and the README links that run.

## The six layers

| Layer | Kind | Command | Needs | Proves |
| --- | --- | --- | --- | --- |
| 1. Unit | unit | `cargo test -p cto --lib` | Rust | `price.rs` math, face ids, SVG assembly, line rendering |
| 2. Sandbox | integration | `cargo test -p cto --test sandbox` (near-workspaces local sandbox) | Rust | The full story with real transactions, keys and errors |
| 3. Relayer | integration | `npm run test:relayer` (Vitest against a sandbox-deployed coin) | Node + Rust | Key derivation, request checks, errors passed through unedited |
| 4. Live | contract checks | `node verify/live.mjs` (JSON-RPC to testnet) | Node | Deployed coins match the code and the rules |
| 5. Simulation | data check | `cargo run -p cto --example sim -- --check` | Rust | Chart data follows the contract math |
| 6. End-to-end | e2e | `npm run test:e2e` (Playwright, Chromium, against the deployed app + `demo-cto.testnet`) | Node + browser | Real clicks work, desktop and phone |

`npm run verify` = layers 1, 2, 4, 5 (prints the 12 PASS lines below). `npm run test:all` = all six. If `cargo` is missing, Rust layers print `SKIP (Rust not installed, see CI: <link>)` and layers 4 and 6 still run.

## Unit cases for price.rs (F = 1,000,000)

| Paid | Idle | Delay / length | Price | Payout | Burned |
| --- | --- | --- | --- | --- | --- |
| vacant | any | any | 1,000,000 | 0 | 1,000,000 |
| 1,000,000 | 0 | 7 d / 7 d | 1,400,000 | 1,150,000 | 250,000 |
| 1,400,000 | 7 d | 7 d / 7 d | 1,960,000 | 1,610,000 | 350,000 |
| 1,000,000 | 10.5 d | 7 d / 7 d | 1,200,000 | floor(23/28 × price) = 985,714.28… | the rest |
| 1,000,000 | 30 d | 7 d / 7 d | 1,000,000 (floor) | 821,428.57… | the rest |

Fractional rows are exact in base units: assert `payout + burned == price` and the floor rounding, not a rounded figure. Also unit-test: face id for ani (2,626), budi (672), launch (9); each line's slot rendering.

## Sandbox story (`contract/tests/sandbox.rs`, run in order)

1. Deploy with `decay_delay_s = 5`, `decay_length_s = 10`; delete the deployer's full-access key.
2. ani and budi `claim_faucet`: 2,000,000 each.
3. ani takes the vacant seat: supply −1,000,000; exactly one function-call key on the coin.
4. ani's voice key calls `announce(1)`: succeeds; text has "1,400,000".
5. budi takes over with `max_price = 1,400,000`: ani +1,150,000, supply −250,000, icon changes.
6. ani's old key calls `announce(3)`: transaction fails with `AccessKeyNotFound`.
7. budi's key calls `ft_transfer`: fails with `MethodNameMismatch`.
8. carol calls with `max_price = 1,000,000`: fails with the "price moved" message.
9. Advance time past 15 s of block time (`fast_forward`): `get_seat` price equals the floor.
10. Every error message in spec 1 is triggered once and matched exactly.

## Live checks (`verify/live.mjs`, no keys)

- `view_access_key_list` on both coins: zero full-access keys; at most one function-call key, method `announce`.
- `view_account` code hash = base58(SHA-256(`res/cto.wasm`)).
- `get_config` equals `reference/constants.json`.
- `ft_total_supply` = 1,000,000,000 − Σ `burned` in `get_history`.
- decoded `ft_metadata().icon` equals `face_svg(seat.face)`.

## Relayer tests (layer 3)

- Same account + takeover index always derive the same key (fixed test vector committed).
- Other contract/method/account/line → HTTP 400 before signing.
- 7th request in a minute from one IP → HTTP 429.
- The relayer's error for ani's old key equals, field for field, the sandbox's error for the same call.

## End-to-end tests (layer 6, `e2e/`)

They run against the deployed app on `demo-cto.testnet`, so they read the seat first and adapt: whoever is not CEO takes the seat. 30 s timeout per transaction, serial, one retry.

| Test | Steps | Passes when |
| --- | --- | --- |
| E2E-1 Takeover, desktop 1920×1080 | Front page → Takeover desk → pick 4 parts → Play as the non-CEO → TAKE THE SEAT | Sequence plays; BREAKING names the new CEO; tx link → `testnet.nearblocks.io/txns/…`; Front page shows new CEO within 6 s; supply fell by exactly the burned amount (RPC) |
| E2E-2 Wow moment | Press office → "Try posting as" the ex-CEO | REJECTED BY NEAR appears only after the response; panel contains `AccessKeyNotFound`; payout card matches `get_history` |
| E2E-3 CEO posts | As CEO pick a line → SIGN AS THE COIN | New press release shows "SIGNED BY demo-cto.testnet" with the live number filled |
| E2E-4 Price moved | Two contexts press TAKE THE SEAT at once | One succeeds; the other shows "price moved to …" and its balance is unchanged |
| E2E-5 Phone 375×812 | Front page, Takeover desk | Sticky TAKE OVER bar visible; no sideways scroll; buttons ≥ 44 px |
| E2E-6 Reduced motion | E2E-1 with reduced motion emulated | Completes; `document.getAnimations()` empty |
| E2E-7 Receipts | Receipts on both coins | Numbers equal `get_config`; full-access keys shown 0; chart loads `/sim/busy.csv` |
| E2E-8 Accessibility | axe-core on four routes | No serious or critical issues |

Wallet mode stays a manual check (human): MyNearWallet on testnet → claim faucet → take seat → post a line → reload the downloaded voice key file in a second browser. Record a GIF for the README.

## Exact `npm run verify` output

```
PASS  price math: 1,000,000 -> 1,400,000 / 1,150,000 / 250,000
PASS  face changes in ft_metadata
PASS  old CEO paid exactly 1.15x
PASS  supply falls exactly 0.25x
PASS  old key rejected on chain (AccessKeyNotFound)
PASS  new key can only call announce
PASS  price decays after the idle window, floor holds
PASS  full-access keys on cto.testnet: 0
PASS  full-access keys on demo-cto.testnet: 0
PASS  deployed code matches res/cto.wasm
PASS  total supply = 1,000,000,000 - burned
PASS  simulation follows the contract math
12 passed · no keys needed
```

A failure prints `FAIL  <same line>` with expected vs actual, and exits 1. Before deploy, the three live lines print `SKIP (not deployed yet)`.

## Done when

- [ ] M8: `npm run verify` prints the 12 PASS lines on a clean clone with Rust, and the live lines without Rust
- [ ] `npm run test:relayer` passes
- [ ] `npm run test:e2e` passes E2E-1 to E2E-8 against the deployed app on Fri Nov 13, and again right before submitting
- [ ] Wallet-mode manual check done and recorded as a GIF
- [ ] CI green on the submitted commit
- [ ] Receipts shows the same verify output as the latest CI run
