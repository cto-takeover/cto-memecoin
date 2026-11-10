# DESIGN: CTO, "Boardroom Tabloid"

Every takeover is front-page news. Fun layer = face, stamps, headlines, stickers. Proof layer = mono numbers, tx chips, verify output. Never mix: stamps label numbers, never cover them.

Mockups: `../mockups/` (static HTML + screenshots)

## Colors
| Token | Hex | Use |
|---|---|---|
| paper | #FFF6E0 | page background |
| ink | #111111 | text, 3px borders, 4px 4px 0 hard shadows |
| near-green | #00EC97 | active / valid / PASS fills; green text only on ink |
| takeover-red | #D7141A | Take over button, FIRED / REJECTED stamps, burn |
| highlighter | #FFD60A | price stickers |
| muted | #5C5346 | secondary text |
| card | #FFFFFF | card surfaces |
| reject-tint | #FDE3E3 | rejected panel background |
Never green text on paper; never ink text on red under 24px.

## Type (Google Fonts)
- Archivo Black: masthead, headlines, buttons
- Space Grotesk 400/500/700: UI and body
- JetBrains Mono 500/700, tabular-nums: every number, account, tx hash, receipts, verify output
- Luckiest Guy: stamps only (CEO, FIRED!, REJECTED BY NEAR, DELETED, DRAFT)

## Components
Card (white, 3px ink border, 4px hard shadow, square corners) · Button (red fill, paper text, press = translate 2px and shrink shadow, min 48px) · Stamp (Luckiest Guy, 4px border, rotate -8deg, scale-in 1.6 to 1 in ~150-500ms) · Sticker (yellow, -3deg) · Receipt (mono, dashed top/bottom edges) · Tx chip (mono hash + arrow) · Nav pill (current = ink fill).

## Faces
SVG built from parts: 8 backgrounds (incl. batik kawung, parang stripe) x 8 eyes x 8 mouths x 8 extras (incl. CEO tie, peci). Generator: scripts/faces.py. Face number = bg*512 + eyes*64 + mouth*8 + extra + 1.

## Motion
Takeover sequence <= 2.5s: FIRED stamp on old face, old card out, new face in, BREAKING headline, payout toast, burn counter rolls. Everything else < 600ms. Respect prefers-reduced-motion. Optional sound muted by default (stamp thunk), never coin or slot sounds.

## Rules
No gambling cues (reels, dice, 777, jackpot, coin showers, "win/bet/gacor/maxwin"). No real faces or borrowed meme characters. No price chart as hero. "Testnet only · no sale · no admin keys" on every screen. Phone: single column, face first, sticky bottom bar with seat price + TAKE OVER, 44px+ targets.

## Animation catalogue (as built in the mockups)
| Where | Animation | Timing |
|---|---|---|
| Every page | News ticker under the masthead, pauses on hover; pulsing LIVE dot | 32s loop |
| Front page | Face card bobs; CEO stamp thunks in; burn and supply count up; decay countdown ticks every second; TAKE OVER button wiggles; "#2 YOU?" slot pulses; cards rise in | 0.3–1.6s, loops 4–4.5s |
| Takeover desk | Part tabs + swatches update the face live; Shuffle flips 8 random faces like cards; deal-memo bar fills | 90ms per shuffle frame |
| Takeover sequence (Take the seat) | FIRED! stamp → old face flies out → new face drops in with NEW CEO stamp → BREAKING headline types → "+1,150,000 → ani" toast → burn counter rolls +250,000 | about 4s total |
| Press office | Banner drops; ani's post types; "Sending to NEAR…"; REJECTED BY NEAR stamp + panel shake + error; payout counts up to 1,150,000; old key struck through + DELETED stamp; Replay button; signing a press release adds a card | about 3s |
| Receipts | Steps check in one by one; verify lines type out with a cursor; VERIFIED stamp; simulation lines draw in; scenario tabs redraw | 0.15–1.6s |
All motion is off for prefers-reduced-motion users (numbers still update).
