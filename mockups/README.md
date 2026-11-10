# Mockups

Static hi-fi mockups in the "Boardroom Tabloid" style (see `../docs/DESIGN.md`). Open any `.html` in a browser (fonts load from Google Fonts); CSS animations play, but nothing is wired to the chain. `screenshots/` has a PNG of each for quick reference.

| File | Screen | Route in the app | Notes |
| --- | --- | --- | --- |
| `1-front-page.html` | Front page | `/` | Ani is CEO after taking the vacant seat |
| `2-takeover-desk.html` | Takeover desk | `/takeover` | Budi building face #672, Eyes tab open |
| `2b-takeover-sequence.html` | Takeover sequence, end state | overlay on `/takeover` | Plays after a successful `take_seat` |
| `3-press-office.html` | Press office, wow moment | `/press` | **Composer is outdated:** build a 24-line picker, not free text (spec 2) |
| `4-receipts.html` | Receipts | `/receipts` | Chart points are illustrative; the app reads `/sim/*.csv` |
| `5-phone-front-page.html` | Front page at 390 px | `/` on phone | Sticky seat-price bar |
| `6-phone-wow.html` | Wow moment at 390 px | `/press` on phone | Rejection above payout |

Rules when turning these into React:

- Copy layout, tokens, type and motion; replace every number and name with live data from views.
- The faces in the mockups are the real part library (`../reference/faces/`).
- Interactive behaviour (tabs, shuffle, takeover sequence timing, ex-CEO rejection) is specified in `../specs/02-web-app.md` and the animation catalogue in `../docs/DESIGN.md`.
- Mockup numbers in tx hashes ("4Tn…w8E") and the code hash are placeholders.
