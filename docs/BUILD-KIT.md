# CTO build kit

The build kit has all the files that Claude Code needs to build CTO from zero context. CTO is the NEAR memecoin where anyone can take over. This page is for a builder who starts a new repo from the kit.

## Start a build

1. Unzip the kit into an empty folder. This folder becomes the repo.
2. Run `git init` in the folder.
3. Open Claude Code in the folder.
   Claude Code reads `CLAUDE.md` when it starts.
4. Send a first prompt. Example:
   > Read CLAUDE.md, specs/README.md and every spec. Then start with spec 0: write the spike contract and spike/RUN.md with the exact commands I need to run. Stop and wait for my gate results before starting spec 1.
5. Run the gate test and send the results. Example: "Gate A passed / failed, gate B …. Continue with spec 1 and its tests."

## Contents of the kit

- `CLAUDE.md`: briefing, repo layout, build order, hard rules, human-only steps
- `specs/`: the seven build specs (00–06) and an overview
- `reference/`: `constants.json` (every number), `announcement-lines.json`, face parts
- `docs/`: the PRD (background), DESIGN.md (look and motion), and the video script and captions
- `mockups/`: static hi-fi HTML for every screen, with PNG screenshots

Export date: Nov 10, 2026.

Key dates:

- Target submission: Sat Nov 14, 19:00 WIB.
- Hard deadline: Sun Nov 15, 06:59 WIB.
