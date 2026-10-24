import { readFileSync } from 'node:fs';
import { vi, expect, test } from 'vitest';
import { createMotionCatalog } from '../../src/assets';
import { durationMs } from '../../src/contracts';
import { fitSourceAxisCapsule } from '../../tools/assets/bakeGroundedKickDiagnostics';
import {
  GROUNDED_KICK_SOURCE_PINS,
  loadGroundedKickDiagnostics,
  readGroundedKickSources,
} from '../../tools/assets/groundedKickDiagnostic';

const source = () => ({
  sourceBytes: readFileSync(GROUNDED_KICK_SOURCE_PINS.sourcePath),
  manifestBytes: readFileSync(GROUNDED_KICK_SOURCE_PINS.manifestPath),
});

test('two distinct explicit source identities retain peaks, initial hold and next-cell endpoint', () => {
  const result = readGroundedKickSources(source());
  expect(result.map((clip) => clip.clipId)).toEqual([
    'FrontThrustKick',
    'SideKick',
  ]);
  const front = result[0];
  const side = result[1];
  expect(front?.window.startMs).toBe(688.8888478279114);
  expect(front?.window.endMs).toBe(822.2222328186035);
  expect(front?.window.peakMs).toBe(733.3333492279053);
  expect(side?.window.startMs).toBe(533.3333611488342);
  expect(side?.window.endMs).toBe(622.2222447395325);
  expect(side?.window.peakMs).toBe(577.7778029441833);
  expect(front?.sourceFrames).toEqual([31, 36]);
  expect(side?.sourceFrames).toEqual([24, 27]);
  for (const clip of result) {
    expect(clip.acceptance).toBeNull();
    expect(clip.window.acceptance).toBe('provisional-policy');
    expect(clip.window.initialHoldEndMs).toBe(22.22222276031971);
    expect(clip.window.peakMs).toBeGreaterThanOrEqual(clip.window.startMs);
    expect(clip.window.peakMs).toBeLessThan(clip.window.endMs);
    expect(Object.isFrozen(clip)).toBe(true);
    expect(clip.rootPolicy.mode).toBe('grounded-posture-y');
    expect(clip.rootPolicy.sourceSha256).toBe(
      GROUNDED_KICK_SOURCE_PINS.sourceSha256,
    );
  }
});

test('source sides and continuous support provenance are not inferred from FrontKick', () => {
  const [front, side] = readGroundedKickSources(source());
  expect(front?.side).toBe('L');
  expect(front?.supportSide).toBe('R');
  expect(front?.sourceClipPointer).toBe('/clips/8');
  expect(front?.durationMs).toBe(1444.4445371627808);
  expect(side?.side).toBe('R');
  expect(side?.supportSide).toBe('L');
  expect(side?.sourceClipPointer).toBe('/clips/1');
  expect(side?.durationMs).toBe(1177.7777671813965);
  expect(side?.sourceDirection).toContain('lateral');
  expect(front?.rootPolicy.provenance.supportPointer).toBe(
    '/clips/8/support_contacts/support_contacts/0',
  );
  expect(side?.rootPolicy.provenance.supportPointer).toBe(
    '/clips/1/support_contacts/support/0',
  );
});

for (const field of ['sourceBytes', 'manifestBytes'] as const) {
  test(`built-in pins reject tampered ${field}, not caller-supplied trust`, () => {
    const input = source();
    input[field] = Buffer.from(input[field]);
    const last = input[field].length - 1;
    input[field][last] = (input[field][last] ?? 0) ^ 1;
    expect(() => readGroundedKickSources(input)).toThrow('hash');
  });
}

test('one source-axis capsule contains its source points without target-dependent fit', () => {
  const points = [
    { x: -0.06, y: 0, z: -0.08 },
    { x: 0.06, y: 0, z: -0.08 },
    { x: -0.06, y: 0.12, z: 0.22 },
    { x: 0.06, y: 0.12, z: 0.22 },
    { x: 0, y: 0, z: 0.25 },
  ];
  const fit = fitSourceAxisCapsule(points);
  expect(fit.kind).toBe('capsule');
  expect(fit.start.x).toBe(0);
  expect(fit.start.y).toBe(0.06);
  expect(fit.end.x).toBe(fit.start.x);
  expect(fit.end.y).toBe(fit.start.y);
  expect(fit.radiusM).toBeCloseTo(Math.hypot(0.06, 0.06) + 1e-7, 15);
  for (const point of points) {
    const z = Math.max(fit.start.z, Math.min(fit.end.z, point.z));
    expect(
      Math.hypot(point.x - fit.start.x, point.y - fit.start.y, point.z - z),
    ).toBeLessThanOrEqual(fit.radiusM);
  }
  expect(fitSourceAxisCapsule([...points].reverse())).toEqual(fit);
});

test('capsule fitting rejects empty, nonfinite and collapsed source geometry', () => {
  expect(() => fitSourceAxisCapsule([])).toThrow();
  expect(() => fitSourceAxisCapsule([{ x: 0, y: Infinity, z: 0 }])).toThrow();
  expect(() => fitSourceAxisCapsule([{ x: 0, y: 0, z: 0 }])).toThrow();
});

test('source region clipping retains boundary faces as posed-vertex barycentrics', async () => {
  const { clipContactTriangle } = await import(
    '../../tools/assets/bakeGroundedKickDiagnostics'
  );
  const face = {
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: 0 },
      { x: 0, y: 0.1, z: 0 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: -1, z: 0 })),
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  const polygon = clipContactTriangle(face, 'sole');
  expect(polygon).toHaveLength(4);
  expect(polygon.some((b) => b.some((w) => w > 0 && w < 1))).toBe(true);
  for (const b of polygon) {
    expect(b.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 15);
    expect(b.every((w) => w >= 0 && w <= 1)).toBe(true);
    expect((b[2] ?? 0) * 0.1).toBeLessThanOrEqual(0.03500000000000001);
  }
  expect(clipContactTriangle(face, 'heel')).toEqual([]);
  expect(
    clipContactTriangle({ ...face, footWeights: [0, 0, 0] }, 'sole'),
  ).toEqual([]);
  expect(
    clipContactTriangle(
      { ...face, footWeights: [0, 0, 0], toeWeights: [1, 1, 1] },
      'sole',
    ),
  ).toEqual(polygon);
});

const fixture = () => ({
  ...source(),
  candidateBytes: readFileSync(
    'tests/assets/fixtures/grounded-kicks-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/grounded-kicks-v1/recipe.json.fixture',
  ),
});

test('pinned diagnostic retains finite interpolation RED and no gameplay allowance', async () => {
  const entries = loadGroundedKickDiagnostics(fixture());
  expect(entries).toHaveLength(2);
  expect(entries.map((entry) => entry.asset)).toEqual(
    JSON.parse(fixture().candidateBytes.toString()).results.map(
      (entry: { asset: unknown }) => entry.asset,
    ),
  );
  expect(Object.isFrozen(entries)).toBe(true);
  for (const entry of entries) {
    expect(entry.acceptance).toBeNull();
    expect(entry.usage).toBe('diagnostic-broadphase-only');
    expect(entry.finiteMeasurement.maximumFiniteSurfaceEscapeM).toBeGreaterThan(
      0,
    );
    expect(entry.finiteMeasurement.maximumFiniteSurfaceEscapeM).toBeLessThan(
      0.00025,
    );
    expect(
      entry.finiteMeasurement.directionalExcess.find(
        (m) => m.direction === '-Y',
      )?.maximumM,
    ).toBeGreaterThan(0.06);
    expect(
      entry.asset.definition.rootCurve.every((key) => key.position.y === 0),
    ).toBe(true);
    expect(
      entry.rawRootCurve.some((key) => Math.abs(key.position.y) > 0.009),
    ).toBe(true);
    expect(
      entry.polygons.some((polygon) => polygon.coverage === 'clipped'),
    ).toBe(true);
  }
  const catalog = createMotionCatalog(async () =>
    entries.map((entry) => entry.asset),
  );
  await catalog.prepare(new AbortController().signal);
  for (const entry of entries) {
    const { startMs, endMs, peakMs } = entry.descriptor.window;
    const sample = (start: number, end: number) =>
      catalog.sampleMotion(
        entry.descriptor.clipId,
        durationMs(start),
        durationMs(end),
      );
    expect(sample(startMs - 0.01, startMs)?.hitVolumeSegments).toHaveLength(0);
    expect(
      sample(startMs, startMs + 0.01)?.hitVolumeSegments.length,
    ).toBeGreaterThan(0);
    expect(
      sample(peakMs, peakMs + 0.01)?.hitVolumeSegments.length,
    ).toBeGreaterThan(0);
    expect(
      sample(endMs - 0.01, endMs)?.hitVolumeSegments.length,
    ).toBeGreaterThan(0);
    expect(sample(endMs, endMs + 0.01)?.hitVolumeSegments).toHaveLength(0);
  }
  catalog.dispose();
});

for (const field of [
  'candidateBytes',
  'recipeBytes',
  'sourceBytes',
  'manifestBytes',
] as const) {
  test(`diagnostic rejects tampered ${field} before use`, () => {
    const input = fixture();
    const changed = new Uint8Array(input[field]);
    changed[0] = (changed[0] ?? 0) ^ 1;
    expect(() =>
      loadGroundedKickDiagnostics({ ...input, [field]: changed }),
    ).toThrow(/hash mismatch/);
  });
}

test('shared source geometry retains exact clipping order and posed barycentric arithmetic', async () => {
  const { clipBarycentricTriangle, interpolateFace } = await import(
    '../../tools/assets/sourceContactGeometry'
  );
  expect(clipBarycentricTriangle([[1, -1, 1]])).toEqual([
    [1, 0, 0],
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
    [0, 0, 1],
  ]);
  expect(
    interpolateFace(
      [
        { x: 1, y: 2, z: 3 },
        { x: 3, y: 4, z: 5 },
        { x: 5, y: 6, z: 7 },
      ],
      [0.25, 0.5, 0.25],
    ),
  ).toEqual({ x: 3, y: 4, z: 5 });
});

test('shared source geometry retains empty, boundary and invalid half-space behavior', async () => {
  const { clipBarycentricTriangle, positiveArea, stretchBound } = await import(
    '../../tools/assets/sourceContactGeometry'
  );
  const { Matrix4 } = await import('three');
  const original = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  expect(clipBarycentricTriangle([])).toEqual(original);
  expect(clipBarycentricTriangle([[0, 0, 0]])).toEqual(original);
  expect(clipBarycentricTriangle([[-1, -1, -1]])).toEqual([]);
  expect(() => clipBarycentricTriangle([[NaN, 0, 1]])).toThrow('Finite');
  expect(
    positiveArea([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ]),
  ).toBe(false);
  expect(stretchBound(new Matrix4().makeScale(2, 3, 4))).toBe(4);
});

test('shared extraction regenerates frozen kick candidates byte for byte', async () => {
  const { bakeGroundedKickDiagnostics } = await import(
    '../../tools/assets/bakeGroundedKickDiagnostics'
  );
  const result = await bakeGroundedKickDiagnostics(source());
  const actual = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  const expected = readFileSync(
    'tests/assets/fixtures/grounded-kicks-v1/candidate.json.fixture',
  );
  expect(actual.length).toBe(expected.length);
  expect(actual.equals(expected)).toBe(true);
}, 30_000);

test('companion references are explicitly rejected at the legacy reconstruction boundary', async () => {
  const { loadGroundedKickDiagnostics } = await import(
    '../../tools/assets/groundedKickDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/grounded-kicks-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/grounded-kicks-v1/recipe.json.fixture',
  );
  const args = { ...source(), candidateBytes, recipeBytes };
  const before = Buffer.from(candidateBytes);
  const baseline = loadGroundedKickDiagnostics(args);
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
    expect(() => loadGroundedKickDiagnostics(args)).toThrow(
      /additional.*shape|companion/i,
    );
  } finally {
    spy.mockRestore();
  }
  expect(candidateBytes.equals(before)).toBe(true);
  expect(JSON.stringify(loadGroundedKickDiagnostics(args))).toBe(
    JSON.stringify(baseline),
  );
});
