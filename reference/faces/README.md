# Face parts

`faces.py` holds the 32 SVG part strings (8 backgrounds, 8 eyes, 8 mouths, 8 extras) used by the mockups. Port them exactly into `contract/src/face.rs` (Rust constants) and generate `web/src/lib/faces.ts` from this file with a script, so the contract and the page draw identical faces.

- Draw order: background, head circle, mouth, eyes, extra (see `face()` in `faces.py`).
- Face id = bg*512 + eyes*64 + mouth*8 + extra + 1 (1–4,096).
- `parts.json`: part names (for UI labels) and the story faces.
- Samples: `launch-9.svg` ([0,0,1,0], the face before any takeover), `ani-2626.svg` ([5,1,0,1]), `budi-672.svg` ([1,2,3,7]).
- Backgrounds 5 (batik kawung) and 6 (parang stripe) use SVG `<pattern>`s; in the contract use fixed pattern ids (for example `kw` and `pr`).
- Largest face is about 1,744 bytes as SVG (2,328 as base64).
