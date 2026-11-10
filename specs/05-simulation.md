# Spec 5: 60-day simulation (`contract/examples/sim.rs`)

A Rust example that imports the contract's own `price.rs`, so the chart can never disagree with the chain. It plays 60 days on the main coin's rules (7 + 7 day decay) and writes one CSV per scenario for the Receipts screen and the README. It shows the mechanic, not a price forecast.

## Scenarios

| Scenario | Takeovers on day | Takeovers | Burned by day 60 | Supply on day 60 |
| --- | --- | --- | --- | --- |
| busy | 1, 3, 5, 8, 11, 14, 18, 22, 27, 33, 40, 48, 57 | 13 | ≈ 30.95M | ≈ 969.05M |
| quiet | 1, 9, 20, 38 | 4 | ≈ 1.66M | ≈ 998.34M |
| abandoned | 1, 4, 8, then none | 3 | ≈ 1.60M | ≈ 998.40M; price at the 1M floor by day 22 |
| random | seed 42: each hour, a 2% chance someone takes the seat if the price is under 50M | varies | varies | varies |

The totals come from a day-by-day model of the same rules (takeovers at the start of the listed day). The Rust example is the source of truth; `--check` fails if busy drifts more than 0.1% from these numbers.

## Commands

- `cargo run -p cto --example sim -- --scenario busy --out web/public/sim/busy.csv` (repeat for quiet, abandoned, random with `--seed 42`)
- `cargo run -p cto --example sim -- --check` runs all four and asserts the invariants; used by `npm run verify`

| Column | Type | Meaning |
| --- | --- | --- |
| `day` | int 0–60 | Day number |
| `supply` | whole CTO | Total supply at end of day |
| `seat_price` | whole CTO | Price to take the seat at end of day |
| `burned_total` | whole CTO | Burned since launch |
| `takeovers_total` | int | Takeovers since launch |
| `ceo_days` | int | Days the current CEO has held the seat |
| `event` | text | `takeover`, `decay_started`, `at_floor`, or empty |

## Invariants checked

- `supply + burned_total = 1,000,000,000` on every row.
- Supply never rises; it falls only on takeover rows.
- Seat price never drops below 1,000,000 and never decays within 7 days of a takeover.
- Each takeover's burn equals `price - floor(price × 23/28)` from `price.rs`.

## Chart (Receipts screen, see `mockups/4-receipts.html`)

Supply in ink on the left axis, seat price in red on the right axis, a dot per takeover. Tabs busy / quiet / abandoned; lines draw in when a tab opens. Title "Supply over 60 days", subtitle "The mechanic, not a price prediction." Below: takeovers, burned, supply on day 60.

## Done when

- [x] M9: four CSVs in `web/public/sim/`, and `--check` passes (Nov 10: `sim check: ok`; busy 13 takeovers, burned 30,952,085, supply 969,047,915)
- [ ] The Receipts chart reads the CSVs, no hard-coded points
- [ ] The README shows the busy chart as an image with the same numbers

## Build notes (added Nov 10 while implementing)

- **Timing model.** Launch at second 0 with the seat vacant. A takeover on day `d` happens at second `d × 86400`. Each row is the state at the last second of its day, so `ceo_days` is 0 on a takeover row, and abandoned shows `at_floor` on day 22 (day 21 is 1,000,002).
- **Events.** One per row, in priority `takeover` > `at_floor` > `decay_started`. `at_floor` only fires for a held seat (a vacant seat always costs the floor).
- **Whole-CTO rounding.** `supply` rounds down and `burned_total = 1,000,000,000 − supply`, so the two columns add up exactly on every row. The exact base-unit identity and each burn are checked separately, before rounding.
- **Random.** splitmix64 seeded with 42 (no extra crate). Every hour from 01:00 on day 0 to the end of day 60, a 200-in-10,000 roll, taken only if the price at that hour is under 50,000,000. Seed 42 gives 18 takeovers, burned 52,315,320.
- **Numbers** (rules, total supply, floor) load from `reference/constants.json` at build time; `--check` also fails if its ratios differ from the constants in `price.rs`.
- **`--check`** runs all four scenarios, checks the invariants above at every row and every takeover (and the idle window hour by hour), checks busy within 0.1% of the table and quiet/abandoned within 5,000 CTO, and fails if a committed CSV in `web/public/sim/` is missing or differs from a fresh run. Extra flag: `--out-dir DIR` writes all four.
- Results on Nov 10: busy 13 / 30,952,085 burned; quiet 4 / 1,664,286; abandoned 3 / 1,600,000; random 18 / 52,315,320.
