import { existsSync, readFileSync } from 'node:fs';
import { vi, expect, it } from 'vitest';

const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
it('retains peak-only annotation and chooses the explicit provisional contact phase, not peak neighborhood', async () => {
  expect(existsSync('tools/assets/kungFuStraightDiagnostic.ts')).toBe(true);
  const { readKungFuStraightSources } = await import(
    '../../tools/assets/kungFuStraightDiagnostic'
  );
  const [d] = readKungFuStraightSources(input());
  expect(d?.clipId).toBe('KungFuStraight');
  expect(d?.sourceTimesSeconds).toHaveLength(61);
  expect(d?.durationMs).toBe(1355.555534362793);
  const e = d?.events[0];
  expect(e?.sourceFrames).toBeNull();
  expect(e?.diagnosticFrames).toEqual([25, 28]);
  expect(e?.earlierUnselectedFrames).toEqual([24, 26]);
  expect(e?.windowOrigin).toBe('developer-provisional-phase-derived');
  expect(e?.window.startMs).toBe(555.555522441864);
  expect(e?.window.peakMs).toBe(555.555522441864);
  expect(e?.window.endMs).toBe(644.4444060325623);
  expect(e?.window.initialHoldEndMs).toBe(22.22222276031971);
  expect(d?.rootPolicy.mode).toBe('grounded-posture-y');
  expect(e?.boneName).toBe('hand.R');
  expect(e?.intendedRegion).toBe(
    'distal-right-hand-proximal-finger-rim-hypothesis',
  );
});
it('fails closed before geometry on source and recipe mutation', async () => {
  expect(existsSync('tools/assets/kungFuStraightDiagnostic.ts')).toBe(true);
  const { readKungFuStraightSources, validateKungFuStraightRecipes } =
    await import('../../tools/assets/kungFuStraightDiagnostic');
  expect(() =>
    readKungFuStraightSources({ ...input(), sourceBytes: new Uint8Array() }),
  ).toThrow(/hash/);
  const bytes = readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
  );
  expect(validateKungFuStraightRecipes(bytes)).toHaveLength(1);
  expect(() => validateKungFuStraightRecipes(Buffer.from('{}'))).toThrow();
});
it('reuses source hand/rim clipping without dorsal substitution or whole-hand fallback', async () => {
  expect(existsSync('tools/assets/bakeKungFuStraightDiagnostic.ts')).toBe(true);
  const { clipKungFuStraightTriangle } = await import(
    '../../tools/assets/bakeKungFuStraightDiagnostic'
  );
  const face = {
    positions: [
      { x: 0, y: 0.07, z: 0 },
      { x: 0.01, y: 0.07, z: 0 },
      { x: 0, y: 0.08, z: 0 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0.3, z: 0 })),
    weights: [1, 1, 1],
  };
  expect(
    clipKungFuStraightTriangle(face, 'distal-hand-hypothesis'),
  ).toHaveLength(3);
  expect(
    clipKungFuStraightTriangle(
      {
        ...face,
        normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -1 })),
      },
      'distal-hand-hypothesis',
    ),
  ).toHaveLength(0);
});

it('retains posture Y while extracting original XZ under the existing explicit policy', async () => {
  const { readKungFuStraightSources } = await import(
    '../../tools/assets/kungFuStraightDiagnostic'
  );
  const { extractedTranslation } = await import('../../src/assets/rootPolicy');
  const [d] = readKungFuStraightSources(input());
  if (!d) throw new Error('descriptor');
  expect(
    extractedTranslation({ x: 0.01, y: -0.025, z: 0.073 }, d.rootPolicy),
  ).toEqual({ x: 0.01, y: 0, z: 0.073 });
  expect(d.rootPolicy.provenance.supportPointer).toBe(
    '/clips/8/support_contacts/contact',
  );
  expect(d.rootPolicyAcceptance).toBeNull();
});
it('preserves proximal crossing-rim evidence and rejects malformed or dorsal alternatives', async () => {
  const { clipKungFuStraightTriangle } = await import(
    '../../tools/assets/bakeKungFuStraightDiagnostic'
  );
  const face = {
    positions: [
      { x: 0, y: 0.019, z: -0.01 },
      { x: 0.01, y: 0.021, z: -0.01 },
      { x: 0, y: 0.019, z: -0.02 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -0.5 })),
    weights: [1, 1, 1],
  };
  expect(
    clipKungFuStraightTriangle(face, 'proximal-finger-hypothesis'),
  ).toEqual([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);
  expect(() =>
    clipKungFuStraightTriangle(
      { ...face, weights: [NaN, 1, 1] },
      'proximal-finger-hypothesis',
    ),
  ).toThrow();
});

it('loads only the pinned initial advancing sphere and retains qualification limits', async () => {
  const { loadKungFuStraightDiagnostics } = await import(
    '../../tools/assets/kungFuStraightDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
  );
  const result = loadKungFuStraightDiagnostics({
    ...input(),
    candidateBytes,
    recipeBytes,
  });
  expect(result).toHaveLength(1);
  const raw = JSON.parse(candidateBytes.toString()).results[0];
  expect(raw.regions[0].polygons).toHaveLength(470);
  expect(raw.asset.definition.impacts[0].damageShare).toBe(1);
  expect(raw.asset.definition.rootCurve.at(-1).position).toEqual({
    x: 0.010000000707805157,
    y: 0,
    z: 0.07300001382827759,
  });
  expect(raw.acceptance).toBeNull();
  expect(raw.continuousContainment).toBeNull();
  expect(() =>
    loadKungFuStraightDiagnostics({
      ...input(),
      candidateBytes: Buffer.concat([candidateBytes, Buffer.from(' ')]),
      recipeBytes,
    }),
  ).toThrow(/hash/);
});

it('companion references are explicitly rejected at the legacy reconstruction boundary', async () => {
  const { loadKungFuStraightDiagnostics } = await import(
    '../../tools/assets/kungFuStraightDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/kungfu-straight-v1/recipe.json.fixture',
  );
  const args = { ...input(), candidateBytes, recipeBytes };
  const before = Buffer.from(candidateBytes);
  const baseline = loadKungFuStraightDiagnostics(args);
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
    expect(() => loadKungFuStraightDiagnostics(args)).toThrow(
      /additional.*shape|companion/i,
    );
  } finally {
    spy.mockRestore();
  }
  expect(candidateBytes.equals(before)).toBe(true);
  expect(JSON.stringify(loadKungFuStraightDiagnostics(args))).toBe(
    JSON.stringify(baseline),
  );
});
