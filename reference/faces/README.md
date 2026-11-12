# Face parts

`faces.py` holds the 32 SVG part strings that the mockups use: 8 backgrounds, 8 eyes, 8 mouths, and 8 extras. The contract and the web app must draw identical faces, so both use these strings:

- `contract/src/face.rs` has an exact port of the strings as Rust constants.
- `scripts/gen-faces.py` generates `web/src/lib/faces.ts` from `faces.py`.

## Facts about the faces

- Draw order: background, head circle, mouth, eyes, extra (see `face()` in `faces.py`).
- Face id = bg*512 + eyes*64 + mouth*8 + extra + 1 (1–4,096).
- `parts.json`: part names (for UI labels) and the story faces.
- Samples: `launch-9.svg` ([0,0,1,0], the face before any takeover), `ani-2626.svg` ([5,1,0,1]), `budi-672.svg` ([1,2,3,7]).
- Backgrounds 5 (batik kawung) and 6 (parang stripe) use SVG `<pattern>` elements. The contract uses fixed pattern ids for them, for example `kw` and `pr`.
- The largest face is about 1,744 bytes as SVG, and 2,328 bytes as base64.
