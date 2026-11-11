# Spec 1: Contract (`cto.testnet`, `demo-cto.testnet`)

One Rust contract is both the coin and the CEO seat. Deploy with `new()`, then delete every full-access key on the account; from then on its only key is the current CEO's voice key. Stack: `near-sdk` 5.x, `near-contract-standards` fungible token (NEP-141, NEP-145, NEP-148), built with `cargo near build`. Crate name `cto`, at `contract/`.

## State

| Field | Type | Meaning |
| --- | --- | --- |
| `token` | `FungibleToken` | Balances, total supply, storage registration |
| `config` | `Config` | `opening_price`, `decay_delay_s`, `decay_length_s`, `faucet_amount`, `name`, `symbol`; set in `new()`, no setter exists |
| `seat` | `Option<Seat>` | `None` until the first takeover |
| `Seat` | `{ ceo, paid, since_ns, face, voice_key }` | Holder, what they paid, when, their face, their voice public key |
| `history` | `Vector<Takeover>` | `{ index, ceo, previous_ceo, paid, payout, burned, face, at_ns, block_height }` |
| `announcements` | `Vector<Announcement>` used as a ring of 50 | `{ index, ceo, line, text, at_ns }` |
| `faucet_pool` | `u128` | Unclaimed supply, held by the contract account |
| `claimed` | `LookupSet<AccountId>` | Accounts that used the faucet |

## Methods

| Method | Kind | Who | What it does |
| --- | --- | --- | --- |
| `new(name, symbol, opening_price, decay_delay_s, decay_length_s, faucet_amount, allocations)` | init | deployer, once | Mints 1,000,000,000 CTO: `allocations: Vec<(AccountId, U128)>` to listed accounts (registering their storage), the rest to `faucet_pool` |
| `claim_faucet()` | call, payable | anyone, once per account | Registers storage (attach ≥ 0.00125 NEAR; refund excess) and pays `faucet_amount` from the pool |
| `take_seat(face, new_ceo_key, max_price)` | call, payable exactly 0.25 NEAR | any registered holder | The takeover (steps below) |
| `announce(line: u8)` | call | only the coin's own account, signed with the current voice key | Posts one of the 24 lines with slots filled; emits an event |
| `get_seat()` | view | anyone | `{ ceo, paid, current_price, since_ns, face, face_id, voice_key, seconds_until_decay, decaying }`, or vacant info with the opening price |
| `get_config()` | view | anyone | All launch numbers, plus `"takeover_ratio": "7/5"` and `"payout_ratio": "23/28"` |
| `get_history(from_index, limit)` | view | anyone | Takeovers newest first, `limit ≤ 50` |
| `get_announcements(limit)` | view | anyone | Latest posts, ≤ 50 |
| `get_lines()` | view | anyone | The 24 line templates, so the page and relayer never keep their own copy |
| `face_svg(face)` | view | anyone | The SVG for any face (previews match the chain byte for byte) |
| `faucet_status(account_id)` | view | anyone | `{ pool_left, claimed }` |
| `ft_*`, `storage_*` | standard | anyone | NEP-141 / NEP-145; `ft_metadata().icon` is the live face |

All amounts in JSON are `U128` strings in base units (18 decimals).

## Price math (`src/price.rs`, pure, no `env`)

Integers in base units; every division rounds down. P = what the current CEO paid, F = opening price (the floor), D = decay delay, L = decay length (seconds), idle = seconds since the last takeover.

```
top    = floor(7 * P / 5)
price  = F                                              if seat vacant
       = top                                            if idle <= D
       = max(F, top - floor((top - F) * min(idle - D, L) / L))   otherwise
payout = 0                                              if seat vacant
       = floor(23 * price / 28)                         otherwise
burned = price - payout
```

Story check: P = 1,000,000 gives price 1,400,000, payout 1,150,000, burned 250,000. Next price 1,960,000. Use `u128` with checked math; `7 * P` cannot overflow for supply 10^27.

## take_seat, step by step

1. Require exactly 0.25 NEAR attached; else `CTO: attach exactly 0.25 NEAR for the voice key`.
2. Each face part 0–7; else `CTO: unknown face part`.
3. Compute `price` now. If `price > max_price`: `CTO: price moved to {price} CTO, above your max {max_price}`.
4. If the caller's balance < `price`: `CTO: price is {price} CTO, you have {balance}`.
5. If `new_ceo_key` equals the current voice key: `CTO: that voice key is already in use`.
6. Move money: withdraw `price` from the caller; deposit `payout` to the old CEO; reduce total supply by `burned`.
7. Write the new `Seat`; push a `Takeover`.
8. Emit NEP-141 `ft_transfer` (caller → old CEO, memo `takeover payout`; skip when vacant), NEP-141 `ft_burn` (owner = caller, memo `takeover burn`), and `cto` `seat_taken`.
9. One promise batch on `current_account_id`: `delete_key(old voice key)` (skip when vacant), then add `new_ceo_key` as a function-call key (receiver = current account, method `announce`, allowance 0.25 NEAR). Attach callback `on_key_swap` that logs success or failure.

In messages, `{price}`, `{max_price}`, `{balance}` are whole CTO with commas (truncate decimals).

Steps 1–8 commit in one receipt; the key batch runs in the next receipt of the same transaction. Step 5 removes the only way the batch can fail.

## announce

- Require `predecessor_account_id == current_account_id` and `signer_account_pk == seat.voice_key`; else `CTO: only the coin's voice key can announce`.
- `line` must be 0–23; else `CTO: unknown announcement line`. There is no free text anywhere in the contract.
- Fill slots from chain state: `{next_price}` = current takeover price, `{burned}` = total burned, both whole CTO with commas; `{ceo}` = current CEO account. Store `line` and the rendered `text`; keep the newest 50; emit `cto` `announcement`.
- The ex-CEO never reaches this code: NEAR refuses their transaction with `AccessKeyNotFound` because the key no longer exists. That is the wow moment.

The 24 lines are in `reference/announcement-lines.json` (code constant in `src/lines.rs`).

## Face and icon (`src/face.rs`)

- `Face = { bg, eyes, mouth, extra }`, each 0–7. Face id = bg × 512 + eyes × 64 + mouth × 8 + extra + 1 (1–4,096).
- SVG assembled from the 32 part strings in `reference/faces/faces.py` (`bg`, head circle, `mouth`, `eyes`, `extra`, in that order), 200 × 200 viewBox. Port the strings exactly; drop the inline `style` attribute and add `xmlns`. Pattern ids (`kw…`, `pr…`) use a fixed suffix in the contract. Largest face ≈ 1,744 bytes (2,328 base64).
- `ft_metadata().icon` = `data:image/svg+xml;base64,<svg>` of the current face; before any takeover, the launch face [0, 0, 1, 0] (id 9).
- `reference/faces/*.svg` are expected outputs for tests (ani = id 2,626, budi = id 672, launch = id 9), modulo the pattern id suffix.

## Events (NEP-297, standard `cto`, version `1.0.0`)

| Event | Data |
| --- | --- |
| `seat_taken` | `ceo, previous_ceo, price, payout, burned, face_id, takeover_index` |
| `announcement` | `ceo, index, line, text` |
| `faucet_claim` | `account_id, amount` |

## Invariants (spec 4 tests each)

- Total supply = 1,000,000,000 CTO − Σ `burned` in history.
- Σ balances + faucet pool = total supply.
- Exactly `price` leaves the caller and `payout + burned == price` for every takeover.
- The contract account holds at most one access key, a function-call key for `announce`.
- No method changes `config`, deploys code, mints, or adds a full-access key.

## Done when

- [x] M1: after a takeover, `ft_metadata().icon` decodes to the new face; `face_svg` matches it byte for byte (unit `story_ani_then_budi`, sandbox step 5)
- [x] M2: story numbers hold exactly (1,000,000 → 1,400,000 / 1,150,000 / 250,000); every error message above appears in a test (unit `err_*`, sandbox steps 5, 8, 10)
- [x] M3: old key's `announce` fails with `AccessKeyNotFound`; the new key calling `ft_transfer` fails (`MethodNameMismatch`) (sandbox steps 6, 7)
- [x] M4: 10.5 days idle on a 7 + 7 coin gives exactly 1,200,000 from P = 1,000,000; 30 days gives exactly the floor (unit `price::tests`, `decay_on_chain`; sandbox step 9)
- [ ] M5: `view_access_key_list` on the deployed account shows zero full-access keys (sandbox: zero after deploy, only the voice key after takeovers; testnet check is spec 6)

## Build notes (added Nov 10 while implementing)

Additions the spec did not name. None changes a rule above.

- **Extra error messages** (exact strings, in `contract/src/lib.rs` `errors`): `CTO: faucet already claimed by this account`, `CTO: the faucet is empty`, `CTO: attach at least 0.00125 NEAR to register storage`, `CTO: force unregister is not supported, tokens only burn in takeovers`, `CTO: invalid launch config`, `CTO: allocations exceed the total supply`.
- **Supply only falls in takeovers.** `storage_unregister(force: true)` is refused (it would burn a balance). If NEP-141's `ft_resolve_transfer` would burn a refund (sender unregistered meanwhile), the amount goes back to the faucet pool instead.
- **Old CEO who unregistered still gets paid**: `take_seat` re-registers them (the 0.25 NEAR attached covers the storage).
- `claim_faucet` needs the 0.00125 NEAR only when the caller is not registered yet (for example ani and budi on the demo coin already are).
- `new()` is `#[private]`: only the account itself can call it, in the deploy transaction.
- `get_seat` also returns `vacant`, `floor`, `next_payout`, `next_burned` (what the current CEO would get and what would burn if someone took the seat now). `seconds_until_decay` is 0 when vacant or already decaying.
- `get_history(from_index, limit)`: both optional; `from_index` counts back from the newest (0 = newest). `total_burned()` view added.
- Events carry `data` as a one-element array, like NEP-141's. The faucet pool is minted to the coin account in the launch `ft_mint` event, and each claim is an `ft_transfer` from it, so indexers see balances that add up.
- Sandbox tests use near-sandbox + near-api (what `cargo near new` ships today) instead of near-workspaces; same local node.
- `Takeover` also stores `voice_key`, the key that takeover installed (added Nov 11 for spec 3): the relayer matches its derived key exactly, and the press office can show which key NEAR deleted.
