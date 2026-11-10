# CTO build specs: overview

Exported from the team's spec doc on Nov 10, 2026 and adjusted for an implementer with no other context. Specs are the source of truth; `../reference/constants.json` holds every number.

## Specs and build order

| # | File | What it settles | PRD must-haves | Planned day (WIB) |
| --- | --- | --- | --- | --- |
| 0 | `00-gate-test.md` | Throwaway proof of the two NEAR tricks: contract swaps its own keys; changed icon shows somewhere | prerequisite | Tue Nov 10 |
| 1 | `01-contract.md` | Rust coin + seat: state, methods, price math, key swap, faces, lines, events, errors | M1–M5 | Tue Nov 10 – Wed Nov 11 |
| 4 | `04-tests-and-verify.md` | Unit, sandbox integration, relayer, live checks, simulation check, Playwright e2e; `npm run verify` | M8 | alongside each spec |
| 5 | `05-simulation.md` | 60-day simulation from the contract's own math, CSVs, chart | M9 | Thu Nov 12 |
| 3 | `03-demo-relayer.md` | Serverless functions that sign for demo accounts ani and budi | M6 | Wed Nov 11 |
| 2 | `02-web-app.md` | Four screens, demo and wallet modes, browser-held voice key, animations | M6, M7 | Wed Nov 11 – Thu Nov 12 |
| 6 | `06-deploy-and-demo-run.md` | Accounts, deploy, deleting keys, seeding, video, submission | M5 | Fri Nov 13 – Sat Nov 14 |

Halfway check: Thu Nov 12, 12:00 WIB. If M1–M6 are not done, cut wallet mode (M7) to a single "Take over" button and skip all nice-to-haves.

PRD must-haves for reference: M1 live coin face · M2 take the seat · M3 voice key swap · M4 price decay · M5 no owner keys · M6 demo page without a wallet · M7 wallet connect · M8 one-command check · M9 60-day simulation.

## Shared constants (also in `reference/constants.json`)

| Constant | Main coin `cto.testnet` | Demo coin `demo-cto.testnet` |
| --- | --- | --- |
| Name / symbol / decimals | CTO / CTO / 18 | CTO DEMO / CTOD / 18 |
| Total supply at launch | 1,000,000,000 | 1,000,000,000 |
| Starting balances | none: everything in the faucet pool | ani-cto 200,000,000 · budi-cto 200,000,000 · rest in faucet |
| Faucet claim | 2,000,000 per account, once | same |
| Opening seat price (also the floor) | 1,000,000 | 1,000,000 |
| Takeover price | last paid × 7/5 (1.4x) | same |
| Old CEO payout | 23/28 of what the new CEO pays (= 1.15x when not decayed) | same |
| Burned | the rest (= 0.25x when not decayed) | same |
| Full price window | 7 days (604,800 s) | 2 minutes (120 s) |
| Decay length to the floor | 7 days (604,800 s) | 3 minutes (180 s) |
| Voice key allowance | 0.25 NEAR, attached to `take_seat` | same |
| Announcements / kept | 24 fixed lines / last 50 | same |
| Face parts | 8 × 8 × 8 × 8 = 4,096 faces | same |

Why two coins: judges replay the demo and each takeover raises the price 1.4x. The demo coin's short decay returns the price to the floor after 5 quiet minutes, and its seeded accounts can afford many rounds. Both run the same wasm; only `new()` arguments differ, and the Receipts screen shows them.

## System map

```
 Judge / holder (browser) ──opens──▶ Web app (spec 2, Vercel) ──view calls──▶ Coins (spec 1)
        │                                  │                                cto.testnet
        │ wallet mode: take_seat,          │ demo clicks                    demo-cto.testnet
        │ announce signed as the coin      ▼                                only key: CEO's voice key
        └──────────────────────────▶  Demo relayer (spec 3) ──signs as ani/budi──▶ demo-cto.testnet
 npm run verify (spec 4) ──reads, no keys──▶ Coins
 Simulation (spec 5, uses price.rs) ──CSVs──▶ Web app Receipts
 Deploy (spec 6) ──creates coins, deletes keys──▶ Coins
```

Only two things ever write to a coin: the demo relayer, and a holder's wallet together with the voice key their browser keeps. The page, tests and simulation only read.

## Decisions already made (don't reopen without asking the human)

| Decision | Rule | Why |
| --- | --- | --- |
| Distribution | Faucet inside the contract, 2,000,000 per account once; no team wallet holds supply | "No owner keys" stays true for money too |
| Two deployments | `cto.testnet` (7 + 7 days) and `demo-cto.testnet` (2 + 3 min, seeded ani and budi) | Replayable demo |
| Front-running | `take_seat(…, max_price)` fails with the new price if someone took the seat first | No surprise 1.4x jump |
| Who may announce | Only a transaction signed by the coin's own account with the current voice key | The protocol rejects the old key |
| What can be announced | One of 24 fixed lines, slots filled on chain; no free text anywhere | Nothing rude possible, enforced on chain |
| Decayed payout | Old CEO always gets 23/28 of what is paid | One rule, no special cases |
| Simulation | Rust example importing `price.rs` | Chart can't drift from the rules |
| Tests | Six keyless layers incl. Playwright e2e; CI runs all | Judges can rerun |

## Open items

- Gate test (spec 0) has not been run yet. Spec 1 assumes both gates pass; fallbacks are in spec 0.
- Account names were free on Nov 10, 14:30 WIB; `cto-demo.testnet` is taken by someone else, hence `demo-cto.testnet`. Claim them early.
