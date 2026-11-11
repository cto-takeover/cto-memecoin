# CTO: the memecoin where anyone can take over

**A NEAR testnet memecoin with one CEO seat. Anyone can take it by paying 1.4x what the last CEO paid. The old CEO is paid 1.15x to leave, 0.25x is burned, and NEAR itself locks the old CEO out of the coin's voice.**

Fired, but paid.

- **App:** <!-- app-url -->[cto-memecoin.vercel.app](https://cto-memecoin.vercel.app)<!-- /app-url -->
- **Coins:** [`cto.testnet`](https://testnet.nearblocks.io/address/cto.testnet) (main, 7 days idle + 7 days decay) · [`demo-cto.testnet`](https://testnet.nearblocks.io/address/demo-cto.testnet) (demo, 2 + 3 minutes)
- **Proof:** [CI runs all six test layers](https://github.com/cto-takeover/cto-memecoin/actions/workflows/ci.yml) · `npm run verify` (below)
- NEAR Hackathon, Memecoins track. Testnet only · no sale · no admin keys · open source (MIT).

## Do this, see that (60 seconds, no wallet)

Open the app in a private window. It starts on the demo coin, where two ready-made accounts (ani and budi) sign through a small demo relayer.

1. **Front page**: see who is CEO, the seat price, total burned, and the coin's face. Press **TAKE OVER**.
2. **Takeover desk**: pick 4 face parts, play as whoever is not CEO, press **TAKE THE SEAT**. One transaction pays the old CEO, burns the rest, sets the face, deletes the old CEO's key and adds yours. The sequence shows the real numbers from the chain.
3. **Press office**: press **TRY POSTING AS** the ex-CEO. NEAR answers `AccessKeyNotFound`, and only then does the **REJECTED BY NEAR** stamp appear, above NEAR's raw error. Next to it: what they paid, what they got back, the profit. As the CEO, pick a line and **SIGN AS THE COIN**.
4. **Receipts**: your browser checks the chain itself (zero full-access keys, supply = 1,000,000,000 − burned, icon = the on-chain face) and stamps VERIFIED. Every step links to the explorer. The 60-day simulation chart shows how the price behaves.

On the main coin, use your own testnet wallet (MyNearWallet or Meteor): claim 2,000,000 CTO from the faucet, take the seat, and download your voice key.

## How it works

| Rule | On chain |
| --- | --- |
| Take the seat | `take_seat(face, new_ceo_key, max_price)` with exactly 0.25 NEAR attached. Price = 1.4x what the CEO paid (vacant: 1,000,000). If the price rose above `max_price`, it fails with "price moved". |
| Payout and burn | The old CEO gets 23/28 of the price (1.15x what they paid); the rest is burned. Exact integer math, rounding down; `payout + burned == price` always. |
| Face | The token icon (`ft_metadata.icon`) is built on chain from 4 parts × 8 options = 4,096 fixed faces. No uploads, so nothing rude is possible. |
| Voice | The CEO's key is a function-call access key **on the coin's own account** that may only call `announce(line)`: one of 24 fixed lines, numbers filled in by the contract. No free text on chain. |
| Firing | The same takeover deletes the old key and adds the new one. The ex-CEO's next post is refused by the protocol (`AccessKeyNotFound`), not by a server. |
| Never stuck | After 7 idle days the price falls to the floor (1,000,000) over 7 more days. The demo coin uses 2 + 3 minutes. |
| No owner | After deploy the coin accounts have **no full-access keys**: no upgrades, no mint, no config changes. Supply only goes down. |

## Verify it yourself (no keys)

```bash
git clone https://github.com/cto-takeover/cto-memecoin && cd cto-memecoin
npm ci && npm --prefix web ci
npm run verify
```

<!-- verify:start -->
```text
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
<!-- verify:end -->

Lines 1–7 run the contract's unit tests and a full story on a local NEAR sandbox (Rust needed; without it they print SKIP and link to CI). The live lines read testnet over JSON-RPC: zero full-access keys, at most one voice key limited to `announce`, the deployed code hash equals `res/cto.wasm`, `get_config` equals `reference/constants.json`, and supply equals 1,000,000,000 minus every burn in the history. `npm run verify:live` runs only those.

## Tests

| Layer | Command | Proves |
| --- | --- | --- |
| 1. Unit | `cargo test -p cto --lib` | Price math, face ids and SVG, line rendering |
| 2. Sandbox | `cargo test -p cto --test sandbox` | The whole story with real transactions, keys and errors |
| 3. Relayer | `npm run test:relayer` | Key derivation, request checks, NEAR errors passed through unedited |
| 4. Live | `npm run verify:live` | The deployed coins match the code and the rules |
| 5. Simulation | `cargo run -p cto --example sim -- --check` | The chart data follows the contract math |
| 6. End-to-end | `npm run test:e2e:local` (sandbox) · `E2E_BASE_URL=… npm run test:e2e` (deployed) | Real clicks on desktop and phone, reduced motion, axe accessibility |

`npm run test:all` runs everything. CI runs all six on every push.

## Run it locally

Needs Node 26, Rust 1.95 (from `rust-toolchain.toml`) and cargo-near 0.23.

```bash
npm ci && npm --prefix web ci
npm run dev:chain   # local NEAR sandbox with both coins, ani and budi; writes web/.env.local
npm run dev         # the app on http://localhost:5173, demo relayer included
```

## Repo

| Path | What |
| --- | --- |
| `contract/` | Rust contract (near-sdk 5): `price.rs` pure math, `face.rs`, `lines.rs`, `events.rs`; `tests/sandbox.rs`; `examples/sim.rs` |
| `res/cto.wasm` | The deployed build |
| `web/` | Vite + React app; `web/api/demo/` is the demo relayer (Vercel functions) |
| `verify/`, `e2e/` | `npm run verify` and the Playwright tests |
| `reference/` | `constants.json` (every number), the 24 lines, face parts |
| `specs/`, `docs/` | Build specs, PRD, design system, and the [build kit](docs/BUILD-KIT.md) this was built from |
| `scripts/deploy.md` | The exact deploy commands |

## Honest limits

- **Testnet only.** CTO has no value and nothing is sold. The faucet gives 2,000,000 CTO per account, once.
- **The demo relayer holds ani's and budi's keys** (testnet accounts made for the demo) and signs for any visitor on the demo coin, rate-limited to 6 requests per minute per IP and one takeover per 10 s. It also derives their voice keys from a server secret. The main coin never uses it: there you sign with your own wallet, and your voice key is made in your browser.
- **Wallets may cache token icons**, so a wallet can show an old face for a while. The chain (`ft_metadata`) always has the current one.
- **`res/cto.wasm` is a non-reproducible build** (`cargo near build non-reproducible-wasm`): Docker was not available for `reproducible-wasm`. `npm run verify` still checks that the deployed code hash equals the committed file.
- **Explorer links** use the transaction hash when this browser saw it or nearblocks has indexed it; otherwise they link to the coin's account page.
- The demo coin's price climbs if many people take the seat within a few minutes; it falls back to the floor after 5 quiet minutes.

## License

MIT, see [LICENSE](LICENSE).
