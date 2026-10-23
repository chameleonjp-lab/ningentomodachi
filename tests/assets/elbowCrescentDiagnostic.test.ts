import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const readCategory = (category: 'punch' | 'kick') => ({
  sourceBytes: new Uint8Array(
    readFileSync(
      `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
    ),
  ),
  manifestBytes: new Uint8Array(
    readFileSync(
      `assets/android/motions/completed42-speed15/${category}/manifest.json`,
    ),
  ),
});
const sources = () => ({
  punch: readCategory('punch'),
  kick: readCategory('kick'),
});

it('pins the two distinct source categories, exact clocks and provisional versus authored labels', async () => {
  expect(existsSync('tools/assets/elbowCrescentDiagnostic.ts')).toBe(true);
  const { readElbowCrescentSources } = await import(
    '../../tools/assets/elbowCrescentDiagnostic'
  );
  const clips = readElbowCrescentSources(sources());
  expect(clips.map((c) => c.clipId)).toEqual([
    'ElbowStrike',
    'OutsideCrescentKick',
  ]);
  expect(clips.map((c) => c.category)).toEqual(['punch', 'kick']);
  expect(clips.map((c) => c.sourceTimesSeconds.length)).toEqual([49, 74]);
  expect(
    clips.map((c) => [
      c.events[0]?.window.startMs,
      c.events[0]?.window.endMs,
      c.events[0]?.window.peakMs,
    ]),
  ).toEqual([
    [444.4444477558136, 511.1110806465149, 466.66666865348816],
    [599.9999642372131, 888.8888955116272, 755.5555701255798],
  ]);
  expect(clips.map((c) => c.events[0]?.sourceFrames)).toEqual([null, [27, 39]]);
  expect(clips.map((c) => c.events[0]?.windowOrigin)).toEqual([
    'developer-provisional-around-source-peak',
    'authored-labels-developer-inclusive-cell',
  ]);
  expect(clips.map((c) => c.rootPolicy.mode)).toEqual([
    'in-place-posture-xyz',
    'in-place-posture-xyz',
  ]);
  expect(
    clips.every((c) => c.acceptance === null && Object.isFrozen(c.events)),
  ).toBe(true);
});

it('rejects tampered source and recipe before geometry and rejects unpinned candidate bytes', async () => {
  const {
    readElbowCrescentSources,
    validateElbowCrescentRecipes,
    loadElbowCrescentDiagnostics,
  } = await import('../../tools/assets/elbowCrescentDiagnostic');
  const input = sources();
  input.kick.sourceBytes = new Uint8Array([1]);
  expect(() => readElbowCrescentSources(input)).toThrow(/hash/);
  const bytes = readFileSync(
    'tests/assets/fixtures/elbow-crescent-v1/recipe.json.fixture',
  );
  expect(validateElbowCrescentRecipes(bytes)).toHaveLength(2);
  const changed = JSON.parse(bytes.toString());
  changed.originalRecipeTexts[0] += ' ';
  expect(() =>
    validateElbowCrescentRecipes(Buffer.from(JSON.stringify(changed))),
  ).toThrow(/hash/);
  expect(() =>
    loadElbowCrescentDiagnostics({
      ...sources(),
      recipeBytes: bytes,
      candidateBytes: Buffer.from('{}'),
    }),
  ).toThrow(/hash|unavailable/);
});

it('clips the exact elbow band and original unnormalized normal threshold without restoring crossing faces', async () => {
  expect(existsSync('tools/assets/bakeElbowCrescentDiagnostics.ts')).toBe(true);
  const { clipElbowCrescentTriangle } = await import(
    '../../tools/assets/bakeElbowCrescentDiagnostics'
  );
  const face = {
    positions: [
      { x: 0, y: 0, z: 0.03 },
      { x: 0.01, y: 0.08, z: 0.03 },
      { x: 0.02, y: 0, z: 0.03 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: 0.3 })),
    weights: [1, 1, 1],
  };
  const b = clipElbowCrescentTriangle(
    face,
    'posterior-elbow-band-hypothesis',
    0,
  );
  expect(b.length).toBeGreaterThanOrEqual(3);
  expect(b).not.toContainEqual([0, 1, 0]);
  for (const p of b) expect(p[1] * 0.08).toBeLessThanOrEqual(0.055 + 1e-15);
  expect(
    clipElbowCrescentTriangle(
      {
        ...face,
        normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: 0.24 })),
      },
      'posterior-elbow-band-hypothesis',
      0,
    ),
  ).toHaveLength(0);
  expect(
    clipElbowCrescentTriangle(
      { ...face, weights: [0.49, 0.49, 0.49] },
      'posterior-elbow-band-hypothesis',
      0,
    ),
  ).toHaveLength(0);
});

it('uses outer-edge mesh X relative to original foot origin, mesh Y and positive normal X, not sole or mirrored axes', async () => {
  const { clipElbowCrescentTriangle } = await import(
    '../../tools/assets/bakeElbowCrescentDiagnostics'
  );
  const face = {
    positions: [
      { x: 0.25, y: 0.08, z: 0 },
      { x: 0.26, y: 0.08, z: 0.01 },
      { x: 0.25, y: 0.1, z: 0.01 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0.4, y: 0, z: 0 })),
    weights: [1, 1, 1],
  };
  expect(
    clipElbowCrescentTriangle(face, 'left-outer-foot-edge-hypothesis', 0.2),
  ).toHaveLength(3);
  expect(
    clipElbowCrescentTriangle(face, 'left-outer-foot-edge-hypothesis', 0.24),
  ).toHaveLength(0);
  expect(
    clipElbowCrescentTriangle(
      {
        ...face,
        normals: Array.from({ length: 3 }, () => ({ x: -1, y: 0, z: 0 })),
      },
      'left-outer-foot-edge-hypothesis',
      0.2,
    ),
  ).toHaveLength(0);
  expect(() =>
    clipElbowCrescentTriangle(
      { ...face, weights: [NaN, 1, 1] },
      'left-outer-foot-edge-hypothesis',
      0.2,
    ),
  ).toThrow();
  expect(() =>
    clipElbowCrescentTriangle(face, 'unknown' as never, 0.2),
  ).toThrow();
});

it('rejects unpinned recipes before any asynchronous source preparation', async () => {
  const { bakeElbowCrescentDiagnostics } = await import(
    '../../tools/assets/bakeElbowCrescentDiagnostics'
  );
  const empty = {
    sourceBytes: new Uint8Array(),
    manifestBytes: new Uint8Array(),
  };
  await expect(
    bakeElbowCrescentDiagnostics({
      punch: empty,
      kick: empty,
      recipeBytes: Buffer.from('{}'),
    }),
  ).rejects.toThrow(/recipe/);
});

it('pins exactly the once-generated two-event candidate without hiding raw escapes or loose crescent excess', async () => {
  const { ELBOW_CRESCENT_DIAGNOSTIC_PINS, loadElbowCrescentDiagnostics } =
    await import('../../tools/assets/elbowCrescentDiagnostic');
  expect(ELBOW_CRESCENT_DIAGNOSTIC_PINS.candidateSha256).toBe(
    '2fee6833bd27e9e7ae0a454c06720a3715722e0c72114913ef4a36ecaa4b19ec',
  );
  const entries = loadElbowCrescentDiagnostics({
    ...sources(),
    recipeBytes: readFileSync(
      'tests/assets/fixtures/elbow-crescent-v1/recipe.json.fixture',
    ),
    candidateBytes: readFileSync(
      'tests/assets/fixtures/elbow-crescent-v1/candidate.json.fixture',
    ),
  });
  expect(entries.map((e) => e.regions[0]?.polygons.length)).toEqual([455, 171]);
  for (const entry of entries) {
    expect(entry.acceptance).toBeNull();
    expect(entry.gameplayAllowance).toBeNull();
    expect(entry.asset.definition.impacts).toHaveLength(1);
    expect(entry.asset.definition.impacts[0]?.damageShare).toBe(1);
    expect(
      entry.asset.definition.rootCurve.every(
        (k) => k.position.x === 0 && k.position.y === 0 && k.position.z === 0,
      ),
    ).toBe(true);
    expect(
      entry.regions[0]?.polygons.every((p) => p.restoredLeadingRim === false),
    ).toBe(true);
    expect(
      entry.finiteMeasurement[0]?.maximumFiniteSurfaceEscapeM,
    ).toBeGreaterThan(0);
  }
  expect(
    entries[1]?.finiteMeasurement[0]?.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0.00025);
  expect(
    Math.max(
      ...(entries[1]?.finiteMeasurement[0]?.directionalExcess.map(
        (x) => x.maximumM,
      ) ?? []),
    ),
  ).toBeGreaterThan(0.17);
});
