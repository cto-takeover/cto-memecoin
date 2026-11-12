// Shared paths and sizes for the video scripts (docs/video-agent-prompt.md).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const OUT = join(HERE, 'out');
/** Where the run's events.json and footage/ are (another folder only when trying the edit on a rehearsal). */
export const RUN = process.env.CTO_RUN ? join(OUT, process.env.CTO_RUN) : OUT;

/** The live app. Everything filmed comes from here; nothing local is served to it. */
export const APP = 'https://ctotimes.xyz';

/** Recording viewport (device scale factor 1) and the broadcast band under it. */
export const VIEW = { width: 1920, height: 900 };
export const BAND = { width: 1920, height: 180 };
export const FRAME = { width: 1920, height: 1080 };
export const FPS = 30;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
