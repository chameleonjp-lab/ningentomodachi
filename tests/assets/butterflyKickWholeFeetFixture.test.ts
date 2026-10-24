/** Saved fixtures only. No original-source posing, fitting or contact rerun. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import type { readButterflyKickCollisionCandidate } from '../../tools/assets/butterflyKickCollisionCandidate';
const directory =
  'tests/assets/fixtures/butterfly-kick-separate-whole-feet-v1/';
const expectedHash =
  '967c87267d2ca77376413975ee6856f957dd7119c8829241692aedba6615b069';
interface Candidate {
  asset: MotionAsset;
  declaration: ReturnType<typeof readButterflyKickCollisionCandidate>;
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
test('exact bytes preserve two separate developer feet and null acceptance', () => {
  const b = bytes(),
    c = candidate();
  expect(b.length).toBe(785790);
  expect(createHash('sha256').update(b).digest('hex')).toBe(expectedHash);
  expect(c.asset.shapes).toHaveLength(2);
  expect(c.surfaceSelections.map((s) => s.bone)).toEqual(['foot.L', 'foot.R']);
  expect(c.declaration.model).toMatchObject({
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
    expectedCountPerSide: 2284,
  });
  expect(new Set(c.asset.shapes.map((s) => s.shapeId)).size).toBe(2);
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
  expect(c.declaration.sourceTimesSeconds).toHaveLength(88);
  expect(s.baseKeysMs).toHaveLength(557);
  expect(s.probeKeysMs).toHaveLength(228);
  expect(s.sampleKeysMs).toHaveLength(785);
  expect(s.maximumSourceUpdates).toBe(786);
  expect(s.maximumMeasuredVertexEvaluations).toBe(3585880);
  expect(s.sampleKeysSha256).toBe(
    '1e762a4631179659d0431c03650a114d2f3b1498fdd5a0a9833644b3201a5b4e',
  );
  expect(c.asset.definition.rootCurve.at(-1)?.position).toEqual({
    x: 0.9800001978874207,
    y: 0,
    z: 0.2800000458955765,
  });
  expect(c.asset.definition.rootCurve.at(-1)?.visualYawRad).toBe(
    -6.283185482025166,
  );
});
test('separate half-open windows survive cached catalog preparation', async () => {
  const c = candidate(),
    catalog = createMotionCatalog(async () => [c.asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const d = c.asset.definition;
    expect(d.impacts.map((i) => [i.startMs, i.endMs, i.damageShare])).toEqual([
      [777.7777314186096, 888.8888955116272, 0.5],
      [911.1111164093018, 1066.6667222976685, 0.5],
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
    sampleUpdates: 785,
    attemptedSourceUpdates: 786,
    selectedVertexEvaluations: 3585880,
  });
  expect(r.native.count).toBe(88);
  expect(r.native.maximumQuaternionError).toBe(3.552713678800501e-15);
  expect(r.contacts).toEqual({
    passedControls: 18,
    coreSteps: 172,
    contactQueries: 37,
    sourceUpdates: 0,
    sha256: '7c49208188459993fd9e4f2fdc57e79290bd924950026c76caf4675e2bdff8b0',
  });
  expect(r.evidenceAvailability).toBe(
    'local-only-not-included-not-publicly-available',
  );
});
test('positive residuals and non-anatomical unaccepted status remain explicit', () => {
  const r = recipe();
  expect(r.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(r.residual.ownActiveMaximumM).toEqual([
    0.0006391228918260772, 0.0007686676675206228,
  ]);
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

test('retained peak world spheres reconstruct full XYZ exactly once, not yaw twice', () => {
  const c = candidate();
  const rows = [
    {
      atMs: 822.2222328186035,
      side: 0,
      world: {
        x: 0.03163408635683518,
        y: 1.7838516219435818,
        z: 1.0656498916138484,
      },
    },
    {
      atMs: 955.5554986000061,
      side: 1,
      world: {
        x: 0.17945779140696594,
        y: 1.878997743747169,
        z: 1.0814512566269745,
      },
    },
  ];
  for (const row of rows) {
    const root = c.asset.definition.rootCurve.find((k) => k.atMs === row.atMs),
      volume = c.asset.shapes[row.side]?.keys.find(
        (k) => k.atMs === row.atMs,
      )?.volume;
    if (!root || volume?.kind !== 'sphere') throw Error('Missing pinned peak');
    const world = {
      x: volume.center.x + root.position.x,
      y: volume.center.y + root.position.y,
      z: volume.center.z + root.position.z,
    };
    expect(world).toEqual(row.world);
    const yaw = root.visualYawRad,
      twice = {
        x:
          volume.center.x * Math.cos(yaw) +
          volume.center.z * Math.sin(yaw) +
          root.position.x,
        y: volume.center.y + root.position.y,
        z:
          -volume.center.x * Math.sin(yaw) +
          volume.center.z * Math.cos(yaw) +
          root.position.z,
      };
    expect(
      Math.hypot(twice.x - world.x, twice.y - world.y, twice.z - world.z),
    ).toBeGreaterThan(0.01);
  }
});
