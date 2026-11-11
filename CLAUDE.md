# CLAUDE.md: CTO, the memecoin where anyone can take over

You are building a hackathon entry from scratch. This file is your briefing; everything you need is in this folder. Read it fully before writing code.

## The project in 60 seconds

CTO is a NEAR **testnet** memecoin with one **CEO seat**.

- Anyone can take the seat by paying **1.4x** what the current CEO paid, in CTO.
- The old CEO gets **1.15x** back (they profit from being pushed out); the remaining **0.25x is burned**, so supply shrinks with every takeover.
- The CEO controls the coin's **face** (the token icon wallets show, built on chain from 4,096 fixed part combinations, so nothing rude is possible) and its **voice**: a NEAR function-call access key on the coin's own account that can only call `announce`, which posts one of 24 fixed lines.
- On takeover, the contract **deletes the old CEO's key and adds the new one** in one batch. When the ex-CEO tries to post, NEAR itself rejects the transaction with `AccessKeyNotFound`. That is the demo's wow moment: "Fired, but paid."
- After 7 idle days the price decays to the floor over 7 more days, so the seat never gets stuck.
- After deploy, the coin account has **no full-access keys**: nobody can change the rules.

Hackathon: NEAR Hackathon, Memecoins track. Submission target **Sat Nov 14, 2026, 19:00 WIB (UTC+7)**; hard deadline **Sun Nov 15, 06:59 WIB**. One solo builder (the human you work with). Testnet only, nothing is sold.

## What is in this folder

| Path | What it is | Authority |
| --- | --- | --- |
| `specs/README.md` | Overview: build order, decisions, system map | Read first |
| `specs/00-gate-test.md` … `specs/06-deploy-and-demo-run.md` | The build specs | **Source of truth** |
| `reference/constants.json` | Every number and account name, machine-readable | **Source of truth for numbers**: load it, never retype values |
| `reference/announcement-lines.json` | The 24 fixed announcement lines and their slots | Source of truth |
| `reference/faces/` | `faces.py` (the face part SVG strings), `parts.json`, sample SVGs | Port these strings exactly |
| `docs/PRD.md` | Product requirements (why, who, must-haves M1–M9) | Background; specs win where they differ |
| `docs/DESIGN.md` | Visual system "Boardroom Tabloid": colors, fonts, components, animation catalogue | Source of truth for the look |
| `mockups/*.html`, `mockups/screenshots/*.png` | Static hi-fi mockups of every screen | Visual reference; see `mockups/README.md` |
| `docs/video-script.md` | Script for the 60 s demo video | For the human, Saturday |

If two files disagree: **specs > constants.json > DESIGN.md > mockups > PRD**. If you find a real contradiction, stop and ask the human.

## Repo layout to create

```
/                      root package.json with scripts: verify, test:relayer, test:e2e, test:all
contract/              Rust crate `cto` (near-sdk 5.x + near-contract-standards)
  src/lib.rs           contract: state, methods
  src/price.rs         PURE price math, no env calls (imported by the simulation)
  src/face.rs          face parts + SVG assembly (ported from reference/faces/faces.py)
  src/lines.rs         the 24 lines + slot rendering
  src/events.rs        NEP-297 events
  tests/sandbox.rs     near-workspaces integration story (spec 4)
  examples/sim.rs      60-day simulation (spec 5)
spike/                 throwaway gate-test contract (spec 0)
res/cto.wasm           committed release build
web/                   Vite + React + TS app (spec 2); Vercel project root
  api/demo/*.ts        relayer serverless functions (spec 3)
  public/sim/*.csv     simulation output
  src/lib/faces.ts     generated from reference/faces/faces.py
verify/                live.mjs + run.mjs for `npm run verify` (spec 4)
e2e/                   Playwright tests (spec 4)
scripts/               build, generate faces.ts, deploy helpers (print commands, never hold keys)
.github/workflows/ci.yml
```

## Build order (follow it)

1. **Spec 0, gate test.** Write `spike/` and the step-by-step commands. The human runs them with their testnet keys and fills in the results. If gate A fails, apply the fallback in spec 0 before writing the real contract.
2. **Spec 1, contract**, with **spec 4** layers 1 and 2 (unit + sandbox tests) written alongside, test-first where practical.
3. **Spec 5, simulation** (small, reuses `price.rs`).
4. **Spec 3, relayer**, then **spec 2, web app**, using the mockups.
5. **Spec 4** remaining layers: relayer tests, `verify/live.mjs`, Playwright e2e, CI.
6. **Spec 6**: produce the deploy commands and README; the human deploys and records.

Each spec ends with "Done when" checkboxes. A spec is done only when every box can be ticked with evidence (a passing test or a command output).

## Rules that must never break

- **No owner powers.** No method may change config, upgrade code, mint, or add a full-access key. No `owner_id` field.
- **Numbers come from `reference/constants.json`** (and on chain from `get_config`). The web app never hard-codes a price or supply; it reads views.
- **Exact integer math** in base units (18 decimals), all divisions round down, `payout + burned == price` always. See spec 1.
- **Error messages are part of the API**: use the exact strings in spec 1; tests match them.
- **NEAR errors pass through unedited** (relayer and UI). The REJECTED stamp appears only after a real `AccessKeyNotFound` comes back.
- **No free text on chain.** Announcements are line numbers 0–23 only.
- **Keys:** never commit keys. The relayer reads `ANI_FULL_KEY`, `BUDI_FULL_KEY`, `VOICE_SECRET` from env. Testnet only.
- **No casino cues** in UI copy or motion: no reels, coin showers, "win", "jackpot", "bet", "777". Gambling content is illegal in Indonesia.
- **Accessibility:** text contrast ≥ 4.5:1 (DESIGN.md palette is pre-checked), real buttons, targets ≥ 44 px, honor `prefers-reduced-motion`.
- Every screen footer: "Testnet only · no sale · no admin keys · open source".

## What only the human can do

Ask the human, with exact commands ready to paste, when you reach these:

- Create testnet accounts (`cto.testnet`, `demo-cto.testnet`, `ani-cto.testnet`, `budi-cto.testnet`, `cto-spike.testnet`; all were free on Nov 10) and fund them from the faucet.
- Sign anything with their keys: gate test, deploy, `delete-keys`, seeding.
- Put secrets into Vercel env; connect the Vercel project; make the GitHub repo public.
- The wallet-mode manual check (MyNearWallet), recording the video, posting on X, submitting the form.

## Tooling notes

- Contract: `cargo near build` (use `reproducible-wasm` for the final build; needs Docker; fall back to `non-reproducible-wasm` if Docker is unavailable and say so in the README).
- NEAR CLI: `near` from near-cli-rs; testnet RPC `https://rpc.testnet.fastnear.com` (from `constants.json`; `rpc.testnet.near.org` is deprecated and answers browsers with HTTP 429 after ~20 calls); explorer `https://testnet.nearblocks.io`.
- Fonts: Google Fonts (Archivo Black, Space Grotesk, JetBrains Mono, Luckiest Guy).
- Verify APIs you're unsure of (near-sdk 5.x key actions such as `add_access_key_allowance`, `env::signer_account_pk`, near-workspaces time travel) against the installed crate versions instead of guessing.

## Definition of done for the whole project

- `npm run verify` prints the 12 PASS lines in spec 4 against both deployed coins.
- `npm run test:e2e` passes against the deployed app.
- A judge in a private window with no wallet can run Front page → Takeover desk → Press office → Receipts in under 60 seconds and see the real rejection.
- README: one-line pitch, "do this, see that" steps, contract addresses, verify output, honest limits (testnet only, demo relayer, wallets may cache icons).
