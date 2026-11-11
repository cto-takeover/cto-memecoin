// Spec 2: the app draws faces with src/lib/faces.ts (generated from faces.py);
// it must equal the contract's face_svg exactly.
import { describe, expect, inject, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { faceFromId, faceId, faceSvg, type Face } from '../../src/lib/faces.js';
import { Rpc } from '../../api/_lib/rpc.js';

const sb = inject('sandbox');
const rpc = new Rpc(sb.rpcUrl);

describe('faces.ts', () => {
  it('equals the contract face_svg for 20 random faces (plus the corners)', async () => {
    const ids = new Set<number>([1, 9, 672, 2626, 4096]);
    while (ids.size < 25) ids.add(1 + Math.floor(Math.random() * 4096));
    for (const id of ids) {
      const face: Face = faceFromId(id);
      expect(faceId(face)).toBe(id);
      const chain = await rpc.view<string>(sb.contractId, 'face_svg', { face });
      expect(faceSvg(face), `face #${id}`).toBe(chain);
    }
  });

  it('is up to date with reference/faces/faces.py', () => {
    const root = join(import.meta.dirname, '../../..');
    expect(() => execFileSync('python3', [join(root, 'scripts/gen-faces.py'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
