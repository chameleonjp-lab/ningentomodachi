import { readFileSync } from 'node:fs';
import { vi, expect, test } from 'vitest';
import { createMotionCatalog } from '../../src/assets';
import { durationMs } from '../../src/contracts';
import {
  clipSweepTriangle,
  fitSweepCapsule,
  type SweepTriangle,
} from '../../tools/assets/bakeGroundedSweepDiagnostics';
import {
  loadGroundedSweepDiagnostics,
  readGroundedSweepSources,
  verifyGroundedSweepRecipePlans,
} from '../../tools/assets/groundedSweepDiagnostic';
import { fitSourceAxisCapsule } from '../../tools/assets/sourceContactGeometry';

const input = () => ({
  sourceBytes: new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/kick/android_kick.glb',
    ),
  ),
  manifestBytes: new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/kick/manifest.json',
    ),
  ),
});
test('two exact authored windows and distinct anatomy tags bind native XYZ policy, never LowSweep', () => {
  const descriptors = readGroundedSweepSources(input());
  expect(descriptors).toMatchObject([
    {
      clipId: 'RoundhouseKick',
      sourceFrames: [30, 35],
      sourceClipPointer: '/clips/2',
      regions: ['anterior-shin-hypothesis', 'instep-hypothesis'],
      axis: 'Y',
      rootPolicy: {
        mode: 'in-place-posture-xyz',
        provenance: { supportPointer: '/clips/2/support_contacts/support' },
      },
      window: {
        startMs: 666.6666865348816,
        endMs: 800.000011920929,
        peakMs: 688.8888478279114,
      },
      acceptance: null,
    },
    {
      clipId: 'SideThrustKick',
      sourceFrames: [34, 39],
      sourceClipPointer: '/clips/9',
      regions: ['heel-hypothesis', 'sole-hypothesis'],
      axis: 'Z',
      rootPolicy: { mode: 'in-place-posture-xyz' },
      window: {
        startMs: 755.5555701255798,
        endMs: 888.8888955116272,
        peakMs: 800.000011920929,
      },
      acceptance: null,
    },
  ]);
  expect(descriptors).toHaveLength(2);
});
test('source and manifest tampering reject before diagnostic interpretation', () => {
  for (const key of ['sourceBytes', 'manifestBytes'] as const) {
    const value = input();
    value[key][100] = (value[key][100] ?? 0) ^ 1;
    expect(() => readGroundedSweepSources(value)).toThrow('hash mismatch');
  }
});
test('fixed proper Y rotation and inverse retain capsule radius and mapped endpoints; Z is unchanged', () => {
  const points = [
    { x: -0.2, y: 0.4, z: 0.1 },
    { x: 0.3, y: 0.7, z: -0.1 },
    { x: 0.1, y: -0.2, z: 0.2 },
  ];
  const rotated = points.map((p) => ({ x: p.x, y: -p.z, z: p.y }));
  const expected = fitSourceAxisCapsule(rotated),
    actual = fitSweepCapsule(points, 'Y');
  expect(actual).toEqual({
    kind: 'capsule',
    start: { x: expected.start.x, y: expected.start.z, z: -expected.start.y },
    end: { x: expected.end.x, y: expected.end.z, z: -expected.end.y },
    radiusM: expected.radiusM,
  });
  expect(fitSweepCapsule(points, 'Z')).toEqual(fitSourceAxisCapsule(points));
  expect(points[0]).toEqual({ x: -0.2, y: 0.4, z: 0.1 });
});
const face: SweepTriangle = {
  positions: [
    { x: 0, y: 0.08, z: 0.1 },
    { x: 0.01, y: 0.08, z: 0.1 },
    { x: 0, y: 0.09, z: 0.12 },
  ],
  normals: Array.from({ length: 3 }, () => ({ x: 0, y: 1, z: 0 })),
  shinPositions: Array.from({ length: 3 }, () => ({ x: 0, y: 0.2, z: -0.05 })),
  shinNormals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -1 })),
  shinWeights: [1, 1, 1],
  footWeights: [1, 1, 1],
  toeWeights: [0, 0, 0],
};
test('shin and instep use their declared distinct frames and preserve original barycentrics', () => {
  const triangle = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  expect(clipSweepTriangle(face, 'anterior-shin-hypothesis')).toEqual(triangle);
  expect(clipSweepTriangle(face, 'instep-hypothesis')).toEqual(triangle);
  expect(clipSweepTriangle(face, 'sole-hypothesis')).toEqual([]);
  expect(
    clipSweepTriangle(
      { ...face, shinWeights: [0, 0, 0] },
      'anterior-shin-hypothesis',
    ),
  ).toEqual([]);
  const clipped = clipSweepTriangle(
    { ...face, shinWeights: [0, 1, 1] },
    'anterior-shin-hypothesis',
  );
  expect(clipped).toHaveLength(4);
  for (const b of clipped) expect(b[0] + b[1] + b[2]).toBeCloseTo(1, 14);
});

const diagnosticInput = () => ({
  ...input(),
  candidateBytes: new Uint8Array(
    readFileSync(
      'tests/assets/fixtures/grounded-sweeps-v1/candidate.json.fixture',
    ),
  ),
  recipeBytes: new Uint8Array(
    readFileSync(
      'tests/assets/fixtures/grounded-sweeps-v1/recipe.json.fixture',
    ),
  ),
});
test('pinned raw candidates remain diagnostic with distinct source region bindings and zero transport', () => {
  const entries = loadGroundedSweepDiagnostics(diagnosticInput());
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    expect(entry.usage).toBe('diagnostic-broadphase-only');
    expect(entry.acceptance).toBeNull();
    expect(entry.rootPolicy.mode).toBe('in-place-posture-xyz');
    expect(
      entry.asset.definition.rootCurve.every(
        (k) => k.position.x === 0 && k.position.y === 0 && k.position.z === 0,
      ),
    ).toBe(true);
    expect(new Set(entry.polygons.map((p) => p.region))).toEqual(
      new Set(entry.descriptor.regions),
    );
    expect(Object.isFrozen(entry.asset.definition)).toBe(true);
  }
  expect(
    entries[0]?.finiteMeasurement.maximumFiniteSurfaceEscapeM,
  ).toBeLessThan(0);
  expect(
    entries[1]?.finiteMeasurement.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0.0000558);
});
test('built-in source, recipe and candidate pins reject mutation including changed root policy', () => {
  for (const key of [
    'sourceBytes',
    'manifestBytes',
    'recipeBytes',
    'candidateBytes',
  ] as const) {
    const value = diagnosticInput();
    value[key][100] = (value[key][100] ?? 0) ^ 1;
    expect(() => loadGroundedSweepDiagnostics(value)).toThrow('hash mismatch');
  }
});

test('fixed recipe-plan bytes must verify before any geometry preparation', () => {
  const recipe = JSON.parse(
    new TextDecoder().decode(diagnosticInput().recipeBytes),
  ) as { planJsonUtf8: string[] };
  const plans = recipe.planJsonUtf8.map((plan) =>
    new TextEncoder().encode(plan),
  );
  expect(() => verifyGroundedSweepRecipePlans(plans)).not.toThrow();
  expect(() => verifyGroundedSweepRecipePlans([...plans].reverse())).toThrow(
    'Fixed recipe plan hash mismatch',
  );
  const changed = plans.map((bytes) => bytes.slice());
  const first = changed[0];
  if (!first) throw new Error('Missing plan');
  first[10] = (first[10] ?? 0) ^ 1;
  expect(() => verifyGroundedSweepRecipePlans(changed)).toThrow(
    'Fixed recipe plan hash mismatch',
  );
});

test('public catalog preserves authored-inclusive-cell boundaries without expanding inactive time', async () => {
  const entries = loadGroundedSweepDiagnostics(diagnosticInput());
  const catalog = createMotionCatalog(async () =>
    entries.map((entry) => entry.asset),
  );
  try {
    await catalog.prepare(new AbortController().signal);
    for (const entry of entries) {
      const { startMs, endMs } = entry.descriptor.window;
      expect(
        catalog.sampleMotion(
          entry.descriptor.clipId,
          durationMs(startMs),
          durationMs(startMs + 0.001),
        )?.hitVolumeSegments.length,
      ).toBeGreaterThan(0);
      expect(
        catalog.sampleMotion(
          entry.descriptor.clipId,
          durationMs(endMs),
          durationMs(endMs + 0.001),
        )?.hitVolumeSegments,
      ).toEqual([]);
    }
  } finally {
    catalog.dispose();
  }
});

test('companion references are explicitly rejected at the legacy reconstruction boundary', async () => {
  const { loadGroundedSweepDiagnostics } = await import(
    '../../tools/assets/groundedSweepDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/grounded-sweeps-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/grounded-sweeps-v1/recipe.json.fixture',
  );
  const args = { ...input(), candidateBytes, recipeBytes };
  const before = Buffer.from(candidateBytes);
  const baseline = loadGroundedSweepDiagnostics(args);
  expect(baseline.length).toBeGreaterThan(0);
  const nativeParse = JSON.parse;
  const extended = nativeParse(candidateBytes.toString());
  extended.results[0].asset.definition.impacts[0].additionalShapeIds = [
    'synthetic-companion',
  ];
  // Pins stay exact. Only the candidate parser result is replaced to exercise this
  // legacy schema boundary; source/recipe parsing remains real and no evaluator runs.
  const spy = vi
    .spyOn(JSON, 'parse')
    .mockImplementation((text, reviver) =>
      text === candidateBytes.toString()
        ? extended
        : nativeParse(text, reviver),
    );
  try {
    expect(() => loadGroundedSweepDiagnostics(args)).toThrow(
      /additional.*shape|companion/i,
    );
  } finally {
    spy.mockRestore();
  }
  expect(candidateBytes.equals(before)).toBe(true);
  expect(JSON.stringify(loadGroundedSweepDiagnostics(args))).toBe(
    JSON.stringify(baseline),
  );
});
