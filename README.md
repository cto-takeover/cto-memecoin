# CTO build kit

Everything Claude Code needs to build CTO, the NEAR memecoin where anyone can take over, from zero context.

## How to start

1. Unzip into an empty folder that will become the repo, then run `git init`.
2. Open Claude Code in that folder. It reads `CLAUDE.md` automatically.
3. First prompt, for example:
   > Read CLAUDE.md, specs/README.md and every spec. Then start with spec 0: write the spike contract and spike/RUN.md with the exact commands I need to run. Stop and wait for my gate results before starting spec 1.
4. After the gate results: "Gate A passed / failed, gate B …. Continue with spec 1 and its tests."

## What's inside

- `CLAUDE.md`: briefing, repo layout, build order, hard rules, human-only steps
- `specs/`: the seven build specs (00–06) and an overview
- `reference/`: `constants.json` (every number), `announcement-lines.json`, face parts
- `docs/`: PRD (background), DESIGN.md (look and motion), video script and captions
- `mockups/`: static hi-fi HTML for every screen, with PNG screenshots

Exported Nov 10, 2026. Key dates: target submission Sat Nov 14, 19:00 WIB; hard deadline Sun Nov 15, 06:59 WIB.
