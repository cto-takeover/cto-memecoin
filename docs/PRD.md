# PRD: CTO, the memecoin where anyone can take over

Written Nov 9, 2026. **Background document: the specs in `../specs/` win wherever they differ.** Later decisions that change this PRD:

- Announcements are one of 24 fixed lines (`reference/announcement-lines.json`), not free text; the CEO console is a line picker.
- CTO is distributed by an in-contract faucet (2,000,000 per account, once); no team wallet.
- Two deployments: `cto.testnet` (7 + 7 day decay) and `demo-cto.testnet` (2 + 3 minute decay, seeded ani-cto / budi-cto). Demo accounts are `ani-cto.testnet` and `budi-cto.testnet`.
- `take_seat` takes a `max_price` (front-running protection).
- Tests cover unit, integration and Playwright end-to-end (spec 4).
- The launch face is [0, 0, 1, 0] (id 9).

## One-liner
A NEAR memecoin with one CEO seat anyone can take by paying 1.4x the last price. The old CEO is paid 1.15x to leave, 0.25x is burned, and the CEO controls the coin's face and its official on-chain voice.

## Problem (who, what, why it matters)
- Who (draft persona): Raka, 24, Jakarta, holds a memecoin whose creator went quiet; the creator still controls logo and channels.
- What: community takeovers happen off chain (new Telegram, new X); nothing on the coin admits who speaks for it. The chart is the only game.
- Why: the coin's identity is shared by every holder but kept by one person. CTO makes it a priced public seat where every fight burns coins.

## Judging criteria fit (criterion: how we score)
- Fits track 5: community drives supply, every takeover burns
- Judge can run it 5: `npm run verify`, no keys; demo page without wallet
- 60-second demo 5: Ani takes seat, Budi takes over, Ani's old key rejected on chain
- Uses NEAR deeply 5: contract swaps a limited access key on its own account; icon computed on chain
- Who pays / why now 4 (weakest): whales, brands, rival communities pay to be the face
- Original and lasting 5: no rival in 95 projects; precedent Cigarette Token CEO seat
Target 28-29/30 if built to the checklist.

## Core flow (numbered steps) and wow moment
1. Open coin page: face, CEO name, seat price, supply, latest announcement.
2. Ani takes the seat (1,000,000 CTO, vacant seat, all burned); face changes.
3. Ani posts line 1 ("The face is mine until someone pays 1,400,000 CTO."), signed by the coin's own account.
4. Budi takes over for 1,400,000: Ani +1,150,000, 250,000 burned, face changes.
5. Ani posts again: rejected on chain, her key no longer exists.
6. Proof panel: explorer links, supply counter, verify PASS lines.
Wow moment: steps 4-5 side by side, "Ani +1,150,000 CTO" next to the red on-chain error.

## Coin rules
Supply 1,000,000,000 CTO. Opening price 1,000,000. Takeover 1.4x CEO's paid price. Old CEO gets 1.15x (82.1% of payment); rest (17.9%) burned with ft_burn event. Decay: after 7 days idle, price falls linearly over 7 days to opening price; payout stays 82.1% of what is paid. Face: fixed parts 8 bg x 8 eyes x 8 mouths x 8 extras = 4,096, SVG in ft_metadata().icon. Voice: function-call key on coin account, method `announce` only, 0.25 NEAR allowance paid by new CEO. Key swap: DeleteKey(old)+AddKey(new) in one batch. Seat holder shown as NEAR name. No owner keys.

## Screens (name, purpose, what's on it)
1. Coin page: who runs the coin now. Live face, CEO name + since, seat price + Take over, supply + burned, last 3 announcements, takeover history.
2. Take over: build a face and pay. 4 part pickers + preview, price breakdown, Act as Ani/Budi or Connect wallet, Take the seat.
3. CEO console: speak as the coin. line picker (24 fixed lines), "signed by cto.testnet" badge, result + explorer link; ex-CEO sees on-chain rejection in red.
4. Proof: explorer link per step, 60-day simulation chart, verify output, README link.
Mockups (Boardroom Tabloid style, see DESIGN.md): `../mockups/`. These are the visual reference for the build.

## Must have (user story + done-when checks each)
- M1 Live face. Done: ft_metadata returns new SVG next block; face on explorer or fallback; unknown part refused; get_history lists all.
- M2 Take the seat. Done: old CEO +1.15x exactly; supply -0.25x exactly with ft_burn; low balance fails with clear message.
- M3 Voice key swap. Done: one tx deletes old, adds new; old key announce rejected; new key cannot ft_transfer.
- M4 Decay. Done: sandbox +10 days price < 1.4x; never below opening.
- M5 No owner keys. Done: list-keys shows only CEO function-call key.
- M6 Demo page without wallet. Done: screens 1-4 run core flow as Ani/Budi; explorer link each step.
- M7 Wallet connect. Done: take over + announce via Wallet Selector on testnet.
- M8 npm run verify. Done: sandbox tests + live views, one PASS line per rule.
- M9 60-day simulation. Done: CSV of supply/price/burn per day; chart on Proof and README.

## Nice to have
Share image of current face; takeover leaderboard; announcement mirror bot to X/Telegram; Bahasa Indonesia. Only if M1-M6 pass by Thu Nov 12 12:00 WIB.

## Cut
Harberger tax; uploaded/free-drawn faces; mainnet, sale or trading pool; multiple seats, voting, DAO; minting real NEAR names.

## Faked for the demo
Ani and Budi are seeded testnet accounts signed by a small relayer; decay shown via sandbox time travel + simulation; if a wallet caches the icon, show our page + explorer. Testnet only, no value.

## Tech stack
Rust near-sdk + standard FT (NEP-141/145/148); near-workspaces sandbox tests; Vite + React + near-api-js + Wallet Selector, static hosting; one serverless relayer; simulation script -> CSV; NEAR testnet (account name TBC).
Methods: take_seat(face, new_ceo_key) +0.25 NEAR; announce(text) self-only; ft_metadata; get_seat; get_history; get_announcements; standard FT methods.

## Risks and fallbacks
Monday gate (Nov 9): contract swaps keys on own account in one tx; new SVG shows on explorer or a wallet. Face fails -> ClanTag.
- Wallets cache icon -> page + explorer + on-chain history, say so.
- Contract can't swap own keys -> announce checks caller == CEO (lose ~1 NEAR-depth point).
- Limited key can't attach deposit -> relayer; backup recorded run.
- SVG too big -> keep under 4 KB.
- "CTO" ticker taken -> backup $SEAT.

## Team: who owns what
Wachid, solo, owns everything. Mon gate+PRD+mockups; Mon-Tue contract M1-M5; Tue verify; Wed page+relayer; Thu 12:00 halfway check, wallet+sim; Fri deploy, delete keys, README; Sat video, X post, submit by 19:00 WIB; hard deadline Sun Nov 15 06:59 WIB. If Exodus is submitted too, each README names the other.
