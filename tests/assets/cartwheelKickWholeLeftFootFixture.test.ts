/** Saved fixtures only. No original-source posing, fitting or contact rerun. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import type { readCartwheelKickCollisionCandidate } from '../../tools/assets/cartwheelKickCollisionCandidate';
const directory = 'tests/assets/fixtures/cartwheel-kick-whole-left-foot-v1/';
const expectedHash =
  'ca5b6d8e7b88273a767ee391207f652652236bd7d25c5d85232e5406ceaf2783';
interface Candidate {
  asset: MotionAsset;
  declaration: ReturnType<typeof readCartwheelKickCollisionCandidate>;
  surfaceSelections: { shapeId: string; bone: string; meshes: unknown[] }[];
  acceptance: null;
  gameplayAllowance: null;
}
interface Recipe {
  status: string;
  candidateSha256: string;
  execution: {
    sampleUpdates: number;
    attemptedSourceUpdates: number;
    selectedVertexEvaluations: number;
  };
  native: { count: number; maximumQuaternionError: number };
  contacts: {
    passedControls: number;
    coreSteps: number;
    contactQueries: number;
    sourceUpdates: number;
    sha256: string;
  };
  evidenceAvailability: string;
  residual: {
    ownActiveMaximumM: number[];
    paddingAppliedM: number;
    acceptance: null;
  };
  visuals: { kind: string; actualViewed: boolean; files: unknown[] };
  acceptance: null;
  gameplayAllowance: null;
  sourceAuthoredAnatomy: null;
}
const bytes = () => readFileSync(directory + 'candidate.json.fixture');
const candidate = () => JSON.parse(bytes().toString()) as Candidate;
const recipe = () =>
  JSON.parse(readFileSync(directory + 'recipe.json.fixture', 'utf8')) as Recipe;
test('exact bytes preserve single developer left foot and null acceptance', () => {
  const b = bytes(),
    c = candidate();
  expect(b.length).toBe(1448245);
  expect(createHash('sha256').update(b).digest('hex')).toBe(expectedHash);
  expect(c.asset.shapes).toHaveLength(1);
  expect(c.surfaceSelections.map((s) => s.bone)).toEqual(['foot.L']);
  expect(c.declaration.model).toMatchObject({
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
    expectedSelectedVertexCount: 2284,
  });
  expect(new Set(c.asset.shapes.map((s) => s.shapeId)).size).toBe(1);
  expect(c.asset.definition.impacts.map((i) => i.shapeId)).toEqual(
    c.asset.shapes.map((s) => s.shapeId),
  );
  expect([c.acceptance, c.gameplayAllowance]).toEqual([null, null]);
  for (const s of c.asset.shapes)
    for (const k of s.keys) {
      expect(k.volume.kind).toBe('sphere');
      expect(Number.isFinite(k.volume.radiusM)).toBe(true);
      expect(k.volume.radiusM).toBeGreaterThan(0);
    }
});
test('native clock and finite schedule retain exact bounds', () => {
  const c = candidate(),
    s = c.declaration.schedule;
  expect(c.declaration.sourceTimesSeconds).toHaveLength(91);
  expect(s.baseKeysMs).toHaveLength(575);
  expect(s.probeKeysMs).toHaveLength(189);
  expect(s.sampleKeysMs).toHaveLength(764);
  expect(s.maximumSourceUpdates).toBe(765);
  expect(s.maximumMeasuredVertexEvaluations).toBe(1744976);
  expect(s.sampleKeysSha256).toBe(
    '71d6aad4a48653b0325cb83e7a7f5dcaf599cf3ac32680e9938fed3f9e7a2784',
  );
  expect(c.asset.definition.rootCurve.at(-1)?.position).toEqual({
    x: 2.6750001907348633,
    y: 0,
    z: 0,
  });
  expect(c.asset.definition.rootCurve.at(-1)?.visualYawRad).toBe(0);
});
test('provisional half-open window survive cached catalog preparation', async () => {
  const c = candidate(),
    catalog = createMotionCatalog(async () => [c.asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const d = c.asset.definition;
    expect(d.impacts.map((i) => [i.startMs, i.endMs, i.damageShare])).toEqual([
      [1311.1110925674438, 1533.3333015441895, 1],
    ]);
    for (const i of d.impacts) {
      expect(
        catalog.sampleMotion(d.clipId, durationMs(i.startMs - 0.25), i.startMs)
          ?.hitVolumeSegments,
      ).toHaveLength(0);
      const active = catalog.sampleMotion(
        d.clipId,
        i.startMs,
        durationMs(i.startMs + 0.25),
      );
      expect(active?.hitVolumeSegments.length).toBeGreaterThan(0);
      expect(
        catalog.sampleMotion(d.clipId, i.endMs, durationMs(i.endMs + 0.25))
          ?.hitVolumeSegments,
      ).toHaveLength(0);
    }
  } finally {
    catalog.dispose();
  }
});
test('recipe retains actual source and contact counts, not fresh execution', () => {
  const r = recipe();
  expect(r.candidateSha256).toBe(expectedHash);
  expect(r.execution).toEqual({
    sampleUpdates: 764,
    attemptedSourceUpdates: 765,
    selectedVertexEvaluations: 1744976,
  });
  expect(r.native.count).toBe(91);
  expect(r.native.maximumQuaternionError).toBe(1.0233136015666298e-7);
  expect(r.contacts).toEqual({
    passedControls: 11,
    coreSteps: 266,
    contactQueries: 19,
    sourceUpdates: 0,
    sha256: '41ae96570953bb3df65b2f92d1190e272fdaac3135e452638dda286969aadd06',
  });
  expect(r.evidenceAvailability).toBe(
    'local-only-not-included-not-publicly-available',
  );
});
test('positive residuals and non-anatomical unaccepted status remain explicit', () => {
  const r = recipe();
  expect(r.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(r.residual.ownActiveMaximumM).toEqual([0.001282037585967566]);
  expect(r.residual.paddingAppliedM).toBe(0);
  expect([
    r.residual.acceptance,
    r.acceptance,
    r.gameplayAllowance,
    r.sourceAuthoredAnatomy,
  ]).toEqual([null, null, null, null]);
  expect(r.visuals.kind).toBe('candidate-only-not-source-geometry-overlay');
  expect(r.visuals.actualViewed).toBe(true);
  expect(r.visuals.files).toHaveLength(4);
});

test('retained peak reconstructs full XYZ exactly once with nonzero root travel', () => {
  const c = candidate(),
    t = 1466.6666984558105,
    root = c.asset.definition.rootCurve.find((k) => k.atMs === t),
    volume = c.asset.shapes[0]?.keys.find((k) => k.atMs === t)?.volume;
  if (!root || volume?.kind !== 'sphere') throw Error('Missing pinned peak');
  const world = {
    x: volume.center.x + root.position.x,
    y: volume.center.y + root.position.y,
    z: volume.center.z + root.position.z,
  };
  expect(world).toEqual({
    x: 3.1091827117746975,
    y: 1.1415505019372236,
    z: 0.09265713236247847,
  });
  expect(root.position.x).toBeGreaterThan(3);
  expect(root.position.y).toBeGreaterThan(0.28);
  expect(c.declaration.nativeRootRotation.quaternions).toHaveLength(91);
  expect(c.declaration.sourceAuthoredAnatomy).toBeNull();
});
