/** Saved fixtures only. No original-source posing, fitting or contact rerun. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createMotionCatalog,
  type MotionAsset,
} from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import type { readKungFuAcrobaticComboCollisionCandidate } from '../../tools/assets/kungFuAcrobaticComboCollisionCandidate';
const directory = 'tests/assets/fixtures/kungfu-acrobatic-whole-right-foot-v1/';
const expectedHash =
  '7583586326cd6892e39b5a219b915520d4bf7ad8eb383aed8f025c9a1e2cfa1d';
interface Candidate {
  asset: MotionAsset;
  declaration: ReturnType<typeof readKungFuAcrobaticComboCollisionCandidate>;
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
test('exact bytes preserve three impacts on one developer right foot and null acceptance', () => {
  const b = bytes(),
    c = candidate();
  expect(b.length).toBe(2367271);
  expect(createHash('sha256').update(b).digest('hex')).toBe(expectedHash);
  expect(c.asset.shapes).toHaveLength(1);
  expect(c.surfaceSelections.map((s) => s.bone)).toEqual(['foot.R']);
  expect(c.declaration.model).toMatchObject({
    includesToe: true,
    includesShin: false,
    includesThigh: false,
    shapeUnion: false,
    expectedSelectedVertexCount: 2284,
  });
  expect(new Set(c.asset.shapes.map((s) => s.shapeId)).size).toBe(1);
  expect(c.asset.definition.impacts.map((i) => i.shapeId)).toEqual(
    Array(3).fill(c.asset.shapes[0]?.shapeId),
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
  expect(c.declaration.sourceTimesSeconds).toHaveLength(208);
  expect(s.baseKeysMs).toHaveLength(1314);
  expect(s.probeKeysMs).toHaveLength(1398);
  expect(s.sampleKeysMs).toHaveLength(2712);
  expect(s.maximumSourceUpdates).toBe(2713);
  expect(s.maximumMeasuredVertexEvaluations).toBe(6194208);
  expect(s.sampleKeysSha256).toBe(
    '306b1bbb7f0746222d3136ac32cc81a08697341dc6de0292d850297663ee2caf',
  );
  expect(c.asset.definition.rootCurve.at(-1)?.position).toEqual({
    x: 0.30000001192092896,
    y: 1.4901161193847656e-8,
    z: 2.6900004893541336,
  });
  expect(c.asset.definition.rootCurve.at(-1)?.visualYawRad).toBe(
    12.566370964050272,
  );
});
test('separate half-open windows survive cached catalog preparation', async () => {
  const c = candidate(),
    catalog = createMotionCatalog(async () => [c.asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    const d = c.asset.definition;
    expect(d.impacts.map((i) => [i.startMs, i.endMs, i.damageShare])).toEqual([
      [599.9999642372131, 1199.9999284744263, 1 / 3],
      [1755.5556297302246, 2377.7778148651123, 1 / 3],
      [3000, 3422.222137451172, 1 / 3],
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
    sampleUpdates: 2712,
    attemptedSourceUpdates: 2713,
    selectedVertexEvaluations: 6194208,
  });
  expect(r.native.count).toBe(208);
  expect(r.native.maximumQuaternionError).toBe(3.511477977251284e-7);
  expect(r.contacts).toEqual({
    passedControls: 27,
    coreSteps: 842,
    contactQueries: 63,
    sourceUpdates: 0,
    sha256: 'b4aedee644b88475deb6bcce74e2320e12ff1f26a2f113bd2445b85dcb64132c',
  });
  expect(r.evidenceAvailability).toBe(
    'local-only-not-included-not-publicly-available',
  );
});
test('positive residuals and non-anatomical unaccepted status remain explicit', () => {
  const r = recipe();
  expect(r.status).toBe('measured-diagnostic-only-not-production-accepted');
  expect(r.residual.ownActiveMaximumM).toEqual([
    0.0004886960226433701, 0.003080609000468526, 0.0010314189708112431,
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
      atMs: 888.8888955116272,
      side: 0,
      world: {
        x: -0.08000021971974938,
        y: 1.7759038766927926,
        z: 1.8855537054388498,
      },
    },
    {
      atMs: 2088.8888835906982,
      side: 0,
      world: {
        x: -0.8512559670112849,
        y: 1.4032889186503112,
        z: 1.647206084017009,
      },
    },
    {
      atMs: 3111.1109256744385,
      side: 0,
      world: {
        x: -0.4285369785018558,
        y: 0.9073401429770294,
        z: 2.3062112638678767,
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
    const error = Math.hypot(
      twice.x - world.x,
      twice.y - world.y,
      twice.z - world.z,
    );
    if (yaw === 0) expect(error).toBe(0);
    else expect(error).toBeGreaterThan(0.01);
  }
});
