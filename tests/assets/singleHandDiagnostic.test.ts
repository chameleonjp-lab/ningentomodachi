import { existsSync, readFileSync } from 'node:fs';
import { vi, describe, expect, it } from 'vitest';

const sourceBytes = readFileSync(
  'assets/android/motions/completed42-speed15/punch/android_punch.glb',
);
const manifestBytes = readFileSync(
  'assets/android/motions/completed42-speed15/punch/manifest.json',
);

describe('fixed single-hand source diagnostics', () => {
  it('provides the separately owned source boundary', async () => {
    expect(existsSync('tools/assets/singleHandDiagnostic.ts')).toBe(true);
    const { readSingleHandSources } = await import(
      '../../tools/assets/singleHandDiagnostic'
    );
    const clips = readSingleHandSources({ sourceBytes, manifestBytes });
    expect(clips.map((c) => c.clipId)).toEqual([
      'Jab',
      'Hook',
      'WhippingStrike',
    ]);
    expect(clips.map((c) => c.events.length)).toEqual([1, 1, 1]);
    expect(clips.map((c) => c.sourceTimesSeconds.length)).toEqual([37, 49, 61]);
    expect(
      clips.map((c) => [
        c.events[0]?.window.startMs,
        c.events[0]?.window.endMs,
      ]),
    ).toEqual([
      [244.44444477558136, 288.8889014720917],
      [422.22222685813904, 488.8888895511627],
      [688.8888478279114, 755.5555701255798],
    ]);
    for (const clip of clips) {
      expect(clip.rootPolicy.mode).toBe('in-place-posture-xyz');
      expect(clip.acceptance).toBeNull();
      expect(clip.events[0]?.windowOrigin).toBe(
        'developer-provisional-around-source-peak',
      );
      expect(Object.isFrozen(clip.events)).toBe(true);
    }
  });
});

it('rejects source and recipe tampering before geometry', async () => {
  const { readSingleHandSources, validateSingleHandRecipes } = await import(
    '../../tools/assets/singleHandDiagnostic'
  );
  const bad = new Uint8Array(sourceBytes);
  bad[40] = (bad[40] ?? 0) ^ 1;
  expect(() =>
    readSingleHandSources({ sourceBytes: bad, manifestBytes }),
  ).toThrow(/hash/);
  const bytes = readFileSync(
    'tests/assets/fixtures/single-hand-v1/recipe.json.fixture',
  );
  expect(validateSingleHandRecipes(bytes)).toHaveLength(3);
  const recipe = JSON.parse(bytes.toString());
  recipe.originalRecipeTexts[2] = recipe.originalRecipeTexts[2].replace(
    'normal.z<=-0.25',
    'normal.z>=0.25',
  );
  expect(() =>
    validateSingleHandRecipes(Buffer.from(JSON.stringify(recipe))),
  ).toThrow(/hash/);
});

it('keeps source-prose and accessor clock origins distinct', async () => {
  const { readSingleHandSources } = await import(
    '../../tools/assets/singleHandDiagnostic'
  );
  const clips = readSingleHandSources({ sourceBytes, manifestBytes });
  expect(clips[0]?.events[0]?.sourceEvent.time_seconds).toBe(
    0.24444444444444444,
  );
  expect(clips[0]?.events[0]?.window.peakMs).toBe(266.6666805744171);
  expect(clips[2]?.events[0]?.sourceEvent.time_seconds).toBe(0.688888888888889);
  expect(clips[2]?.events[0]?.window.peakMs).toBe(711.1111283302307);
});

it('distinguishes dorsal from forward and palmar normals, with no whole-hand fallback', async () => {
  const { clipSingleHandTriangle } = await import(
    '../../tools/assets/bakeSingleHandDiagnostics'
  );
  const positions = [
    { x: 0, y: 0.07, z: -0.01 },
    { x: 0.01, y: 0.07, z: -0.01 },
    { x: 0, y: 0.08, z: -0.01 },
  ];
  const face = (normal: { x: number; y: number; z: number }) => ({
    positions,
    normals: [normal, normal, normal],
    weights: [1, 1, 1],
  });
  expect(
    clipSingleHandTriangle(
      face({ x: 0, y: 1, z: 0 }),
      'distal-hand-hypothesis',
    ),
  ).toHaveLength(3);
  expect(
    clipSingleHandTriangle(
      face({ x: 0, y: 1, z: 0 }),
      'dorsal-hand-hypothesis',
    ),
  ).toHaveLength(0);
  expect(
    clipSingleHandTriangle(
      face({ x: 0, y: 0, z: -1 }),
      'dorsal-hand-hypothesis',
    ),
  ).toHaveLength(3);
  expect(
    clipSingleHandTriangle(
      face({ x: 0, y: 0, z: 1 }),
      'dorsal-hand-hypothesis',
    ),
  ).toHaveLength(0);
  expect(() =>
    clipSingleHandTriangle(face({ x: 0, y: 0, z: -1 }), 'unknown' as never),
  ).toThrow();
});

it('restores only the declared proximal upper-y crossing and rejects nonfinite data', async () => {
  const { clipSingleHandTriangle } = await import(
    '../../tools/assets/bakeSingleHandDiagnostics'
  );
  const face = {
    positions: [
      { x: 0, y: 0, z: -0.01 },
      { x: 0.01, y: 0.03, z: -0.01 },
      { x: 0, y: 0.03, z: -0.01 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: -1 })),
    weights: [1, 1, 1],
  };
  expect(
    clipSingleHandTriangle(face, 'proximal-finger-hypothesis'),
  ).toHaveLength(3);
  expect(
    clipSingleHandTriangle(face, 'proximal-finger-hypothesis'),
  ).toContainEqual([0, 1, 0]);
  expect(() =>
    clipSingleHandTriangle(
      { ...face, weights: [NaN, 1, 1] },
      'proximal-finger-hypothesis',
    ),
  ).toThrow();
  const crossing = {
    ...face,
    positions: [
      { x: 0, y: 0, z: -0.01 },
      { x: 0.01, y: 0.03, z: 0.01 },
      { x: 0, y: 0.03, z: -0.01 },
    ],
  };
  expect(
    clipSingleHandTriangle(crossing, 'proximal-finger-hypothesis'),
  ).not.toContainEqual([0, 1, 0]);
});

it('rejects bad recipe bytes before asynchronous source preparation', async () => {
  const { bakeSingleHandDiagnostics } = await import(
    '../../tools/assets/bakeSingleHandDiagnostics'
  );
  await expect(
    bakeSingleHandDiagnostics({
      sourceBytes: new Uint8Array(),
      manifestBytes: new Uint8Array(),
      recipeBytes: new TextEncoder().encode('{}'),
    }),
  ).rejects.toThrow(/recipe/);
});

it('rejects any unpinned candidate or transfer of prior gameplay allowances', async () => {
  const { loadSingleHandDiagnostics, SINGLE_HAND_DIAGNOSTIC_PINS } =
    await import('../../tools/assets/singleHandDiagnostic');
  expect(SINGLE_HAND_DIAGNOSTIC_PINS.candidateSha256).toBe(
    'ee4e708a8d018d6d70a47a5b4ac46dd17a3bbe5d85abc1b2b189b20f2e3c2155',
  );
  expect(() =>
    loadSingleHandDiagnostics({
      sourceBytes,
      manifestBytes,
      recipeBytes: readFileSync(
        'tests/assets/fixtures/single-hand-v1/recipe.json.fixture',
      ),
      candidateBytes: new TextEncoder().encode('{}'),
    }),
  ).toThrow(/hash/);
});

it('loads only the exact initial three-event diagnostic candidate with native XYZ binding', async () => {
  const { loadSingleHandDiagnostics } = await import(
    '../../tools/assets/singleHandDiagnostic'
  );
  const entries = loadSingleHandDiagnostics({
    sourceBytes,
    manifestBytes,
    recipeBytes: readFileSync(
      'tests/assets/fixtures/single-hand-v1/recipe.json.fixture',
    ),
    candidateBytes: readFileSync(
      'tests/assets/fixtures/single-hand-v1/candidate.json.fixture',
    ),
  });
  expect(entries).toHaveLength(3);
  for (const entry of entries) {
    expect(entry.asset.definition.impacts).toHaveLength(1);
    expect(entry.asset.definition.impacts[0]?.damageShare).toBe(1);
    expect(
      entry.asset.definition.rootCurve.every(
        (k) => k.position.x === 0 && k.position.y === 0 && k.position.z === 0,
      ),
    ).toBe(true);
    expect(entry.acceptance).toBeNull();
    expect(entry.gameplayAllowance).toBeNull();
  }
  expect(
    entries[1]?.finiteMeasurement[0]?.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0);
  expect(
    entries[2]?.finiteMeasurement[0]?.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0);
  expect(
    entries[2]?.regions[0]?.polygons.some(
      (p) => p.region === 'dorsal-hand-hypothesis',
    ),
  ).toBe(true);
  expect(
    entries[0]?.regions[0]?.polygons.some(
      (p) => p.region === 'dorsal-hand-hypothesis',
    ),
  ).toBe(false);
});

it('companion references are explicitly rejected at the legacy reconstruction boundary', async () => {
  const { loadSingleHandDiagnostics } = await import(
    '../../tools/assets/singleHandDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/single-hand-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/single-hand-v1/recipe.json.fixture',
  );
  const args = {
    ...{ sourceBytes, manifestBytes },
    candidateBytes,
    recipeBytes,
  };
  const before = Buffer.from(candidateBytes);
  const baseline = loadSingleHandDiagnostics(args);
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
    expect(() => loadSingleHandDiagnostics(args)).toThrow(
      /additional.*shape|companion/i,
    );
  } finally {
    spy.mockRestore();
  }
  expect(candidateBytes.equals(before)).toBe(true);
  expect(JSON.stringify(loadSingleHandDiagnostics(args))).toBe(
    JSON.stringify(baseline),
  );
});
