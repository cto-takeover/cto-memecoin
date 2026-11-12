# Submission form (nearhackathon.com/#apply)

Submit by Sat Nov 14, 19:00 WIB (12:00 UTC). The form closes Nov 14, 23:59 UTC (Sun Nov 15, 06:59 WIB). You cannot edit a submission later; changes go through nearhackathon.com/request-changes. Post on X first, because the form asks for the post link.

| Field | Value |
| --- | --- |
| Project name | CTO |
| Team lead | (your name) |
| Email address | (your email) |
| Team size | 1 — Solo builder |
| Tracks | Memecoins With Mechanics |
| NEAR wallet address | (your **mainnet** account; the prize is paid here) |
| Repository link | https://github.com/cto-takeover/cto-memecoin |
| Demo post link | https://x.com/0xc1d/status/2120811270299640038 |
| Website | https://ctotimes.xyz |
| Consent | tick |

## What did you build? (20–2,000 characters)

```text
$CTO is a NEAR testnet memecoin with one CEO seat. Anyone can take the seat by paying 1.4x what the current CEO paid. The old CEO gets 1.15x back (fired, but paid), and the other 0.25x is burned, so every fight for the seat shrinks the supply.

The CEO controls two things. The first is the coin's face: the NEP-148 token icon, built on chain from 4,096 fixed part combinations, so a rude face is impossible. The second is the coin's voice: a NEAR function-call access key on the coin's own account that can only call announce, which posts one of 24 fixed lines.

The takeover is one transaction. It pays the old CEO, burns the rest, sets the new face, deletes the old CEO's key and adds the new one. When the ex-CEO tries to post, the NEAR protocol itself rejects the transaction with AccessKeyNotFound. No server decides who speaks for the coin.

After 7 idle days the price decays to the floor over 7 more days, so the seat never gets stuck. The coin accounts have zero full-access keys: nobody can upgrade, mint, or change the rules.

Try it without a wallet at ctotimes.xyz (a demo coin with a 5-minute decay and two demo accounts), or use the main coin cto.testnet with your own wallet. `npm run verify` checks 12 rules against the code and the live chain with no keys. The README covers the economics (who gains, who pays), a 60-day simulation from the contract's own price math, and its honest limits.
```
