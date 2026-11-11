# Spec 3: Demo relayer (`web/api/demo/`)

Three Vercel serverless functions (Node, TypeScript, `near-api-js`) that sign for two throwaway testnet accounts, `ani-cto.testnet` and `budi-cto.testnet`, on the demo coin `demo-cto.testnet` only. They exist because a judge has no wallet, and a limited key can't attach the 0.25 NEAR a takeover needs. The relayer never edits what NEAR returns.

## Endpoints

| Endpoint | Body | Does | Returns |
| --- | --- | --- | --- |
| `GET /api/demo/state` | none | Reads both accounts' CTO and NEAR balances, current CEO, current price | `{ ani, budi, ceo, price, decaySecondsLeft }` |
| `POST /api/demo/take-seat` | `{ as: "ani" \| "budi", face: {bg,eyes,mouth,extra}, maxPrice }` | Signs `take_seat` on `demo-cto.testnet` as that account, 0.25 NEAR attached, with the next derived voice public key | `{ txHash, takeoverIndex }` or `{ error }` |
| `POST /api/demo/announce` | `{ as, line }` (line ∈ demo buttons) | Signs `announce(line)` as `demo-cto.testnet` with that account's latest derived voice key | `{ txHash }` or `{ error }` |

`error` is NEAR's own error passed through whole: `{ type: "InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound", message, raw }` (type = the path of keys in NEAR's error object). The web app prints `raw` in the rejected panel.

## Voice keys without a database

Each voice key is derived, never stored: seed = HMAC-SHA256(`VOICE_SECRET`, `"{account}:{takeoverIndex}"`); key pair = ed25519 from that 32-byte seed (e.g. `tweetnacl.sign.keyPair.fromSeed`), encoded as `ed25519:<base58>` for near-api-js.

- take-seat: index = current `get_history` length; send that key's public half as `new_ceo_key`.
- announce: find this account's latest takeover in `get_history`; derive that key; sign with it.
- ani's "old key" for the wow moment is her latest derived key after budi took over. NEAR has deleted it, so the rejection is real.

## Demo lines

The contract accepts only line numbers (spec 1). Demo buttons offer six (from `reference/announcement-lines.json` → `demo_buttons`):

- 1 "The face is mine until someone pays {next_price} CTO."
- 2 "Next takeover costs {next_price} CTO."
- 3 "Wait, I'm still the CEO!" (the ex-CEO button in the wow moment)
- 4 "Fired, but paid. See you at the next takeover."
- 5 "No admin keys. Read the contract."
- 6 "{burned} CTO burned so far. Supply only goes down."

## Limits and setup

| Item | Value |
| --- | --- |
| Allowlist | contract `demo-cto.testnet` only; methods `take_seat`, `announce` only; accounts ani/budi only; lines 1–6 only |
| Rate limits | 6 requests/min per IP (429); one takeover per 10 s overall (in-memory is fine for the demo) |
| Funding | each demo account starts with 20 NEAR (≈ 70 takeovers); `/state` reports NEAR balances; top up below 3 NEAR |
| Secrets (Vercel env) | `ANI_FULL_KEY`, `BUDI_FULL_KEY` (testnet throwaway), `VOICE_SECRET` (32 random bytes, hex) |
| CORS | the app's own origin only |
| Logs | tx hashes and error types only, never keys |

## Done when

- [ ] budi takes the seat from ani via `/take-seat`; the explorer shows ani +1,150,000 (starting from a fresh 1,000,000 price) (sandbox: pass Nov 11, `npm run test:relayer`; testnet: after deploy, spec 6)
- [ ] right after, `/announce` as ani with line 3 returns `AccessKeyNotFound` from NEAR, unedited (sandbox: pass, and equal field for field to the same call sent straight to the node; testnet: after deploy)
- [ ] `/announce` as budi succeeds and the post appears in `get_announcements` (sandbox: pass; testnet: after deploy)
- [x] any other contract, method, account or line is refused with HTTP 400 before anything is signed (14 cases in `web/test/relayer/relayer.test.ts`, sign counter stays 0)

## Build notes (added Nov 11 while implementing)

- **Layout.** Logic in `web/api/_lib/` (`relayer.ts`, `keys.ts`, `errors.ts`, `rpc.ts`, `http.ts`, `config.ts`); `web/api/demo/{state,take-seat,announce}.ts` are thin web-standard handlers (`GET`/`POST(req: Request)`). Numbers and names come from `web/src/lib/reference.ts`, generated from `reference/*.json` by `scripts/gen-reference.mjs` (`--check` fails if stale).
- **Error shape.** Every error is `{ error: { source, type, message, ... } }`. `source: "near"` adds `raw` (NEAR's object exactly as returned) and comes with HTTP 200, plus `txHash` when the transaction executed and failed (e.g. "price moved"). `source: "relayer"` errors: 400 `BadRequest`, 403 `Forbidden` (other origin), 429 `RateLimited`, 409 `NeverCeo` / `NoMatchingKey`, 503 `NotConfigured`, 502 for a failed read (with NEAR's error). The UI stamps REJECTED only for `source: "near"`.
- **`type` and `message`** are read off NEAR's object, never reworded: `type` is the key path (below `TxExecutionError` for rejected transactions; e.g. `ActionError.kind.FunctionCallError.ExecutionError` for a panic), `message` the innermost value (NEAR's string, or its JSON).
- **Signing without a lookup failure.** Nonces are read at `optimistic` finality, so a key added one block earlier counts. If NEAR has no such key, the relayer still signs (nonce = final height × 10^6) and sends, so the rejection is NEAR's own `AccessKeyNotFound` from `send_tx`, not a client-side "key not found".
- **Voice key matching.** The contract now records `voice_key` in each history entry (spec 1 build notes). `/announce` finds the account's latest takeover, then the derived key whose public half equals that entry's `voice_key` (searching down from its index). This stays exact even if another takeover landed between reading the history length and the transaction.
- **Rate limits** apply to the two signing endpoints; `/state` is read-only and not limited. Optional `contract` / `method` fields are accepted only if they name `demo-cto.testnet` and the endpoint's own method; any other field is a 400.
- **Env** besides the three secrets (all optional, defaults from constants.json): `NEAR_RPC_URL`, `DEMO_CONTRACT_ID`, `ANI_ACCOUNT_ID`, `BUDI_ACCOUNT_ID`, `APP_ORIGINS` (extra allowed origins, comma list).
- **Tests** (`npm run test:relayer` at the root): builds the wasm, then Vitest starts a local sandbox, deploys the real contract as the demo coin with the demo numbers and deletes its deployer key. 38 tests: key vector (computed independently with node:crypto), 14 refusals, 429s, origin, missing secrets, and the story.
- TypeScript is pinned to 5.9 (Vite tooling targets 5.x).
