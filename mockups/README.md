# Mockups

This folder has static hi-fi mockups of each screen in the "Boardroom Tabloid" style (see `../docs/DESIGN.md`). They are for the person who builds or reviews the web app.

- Open any `.html` file in a browser. The fonts load from Google Fonts.
- The CSS animations play, but the mockups do not connect to the chain.
- `screenshots/` has a PNG of each mockup for quick reference.

| File | Screen | Route in the app | Notes |
| --- | --- | --- | --- |
| `1-front-page.html` | Front page | `/` | Ani is CEO after taking the vacant seat |
| `2-takeover-desk.html` | Takeover desk | `/takeover` | Budi building face #672, Eyes tab open |
| `2b-takeover-sequence.html` | Takeover sequence, end state | overlay on `/takeover` | Plays after a successful `take_seat` |
| `3-press-office.html` | Press office, wow moment | `/press` | **Composer is outdated:** build a 24-line picker, not free text (spec 2) |
| `4-receipts.html` | Receipts | `/receipts` | Chart points are illustrative; the app reads `/sim/*.csv` |
| `5-phone-front-page.html` | Front page at 390 px | `/` on phone | Sticky seat-price bar |
| `6-phone-wow.html` | Wow moment at 390 px | `/press` on phone | Rejection above payout |

## Turn a mockup into React

- Copy the layout, tokens, type, and motion.
- Replace each number and name with live data from the contract views.
- The faces in the mockups use the real part library (`../reference/faces/`).
- For interactive behavior, read `../specs/02-web-app.md` and the animation catalogue in `../docs/DESIGN.md`. Examples: tabs, shuffle, takeover sequence timing, and the old CEO's rejection.
- The transaction hashes ("4Tn…w8E") and the code hash in the mockups are placeholders.
