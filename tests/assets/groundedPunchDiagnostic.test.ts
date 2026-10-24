import { readFileSync } from 'node:fs';
import { vi, expect, test } from 'vitest';

const source = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});

test('punch batch preserves all five source peaks and separates newly authored Palm interval', async () => {
  const { readGroundedPunchSources } = await import(
    '../../tools/assets/groundedPunchDiagnostic'
  );
  const [combo, palm] = readGroundedPunchSources(source());
  expect(combo?.clipId).toBe('PunchCombo4');
  expect(combo?.sourceClipPointer).toBe('/clips/4');
  expect(combo?.durationMs).toBe(1800.0000715255737);
  expect(
    combo?.events.map((event) => [
      event.side,
      event.peakFrame,
      event.sourceFrames,
    ]),
  ).toEqual([
    ['L', 12, [11, 12]],
    ['R', 24, [23, 24]],
    ['L', 39, [38, 40]],
    ['R', 59, [58, 60]],
  ]);
  for (const event of combo?.events ?? []) {
    expect(event.windowOrigin).toBe('source-explicit-interval');
    expect(event.window.peakMs).toBeGreaterThanOrEqual(event.window.startMs);
    expect(event.window.peakMs).toBeLessThan(event.window.endMs);
    expect(event.acceptance).toBeNull();
  }
  expect(palm?.clipId).toBe('PalmStrike');
  expect(palm?.sourceClipPointer).toBe('/clips/9');
  expect(palm?.events).toHaveLength(1);
  expect(palm?.events[0]?.sourceFrames).toBeNull();
  expect(palm?.events[0]?.diagnosticFrames).toEqual([24, 26]);
  expect(palm?.events[0]?.windowOrigin).toBe(
    'developer-provisional-around-source-peak',
  );
  expect(palm?.events[0]?.peakFrame).toBe(25);
  expect(palm?.events[0]?.window.startMs).toBe(533.3333611488342);
  expect(palm?.events[0]?.window.endMs).toBe(599.9999642372131);
  expect(palm?.events[0]?.sourceEvent).not.toHaveProperty('window');
  for (const clip of [combo, palm]) {
    expect(clip?.acceptance).toBeNull();
    expect(clip?.rootPolicyAcceptance).toBeNull();
    expect(Object.isFrozen(clip)).toBe(true);
  }
});

for (const field of ['sourceBytes', 'manifestBytes'] as const) {
  test(`punch source pins reject changed ${field}`, async () => {
    const { readGroundedPunchSources } = await import(
      '../../tools/assets/groundedPunchDiagnostic'
    );
    const input = source();
    const last = input[field].length - 1;
    input[field][last] = (input[field][last] ?? 0) ^ 1;
    expect(() => readGroundedPunchSources(input)).toThrow('hash');
  });
}

test('source-only hand region clips original boundary faces and distinguishes palmar heel from distal rim', async () => {
  const { clipHandContactTriangle } = await import(
    '../../tools/assets/bakeGroundedPunchDiagnostics'
  );
  const face = {
    positions: [
      { x: 0, y: -0.01, z: 0.02 },
      { x: 0.02, y: 0.02, z: 0.02 },
      { x: -0.02, y: 0.02, z: 0.02 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: 1 })),
    weights: [1, 1, 1],
  };
  const palm = clipHandContactTriangle(face, 'palmar-heel');
  expect(palm.length).toBe(4);
  expect(
    palm.some((point) => point.filter((value) => value > 0).length > 1),
  ).toBe(true);
  expect(clipHandContactTriangle(face, 'distal-hand')).toEqual([]);
  expect(() =>
    clipHandContactTriangle({ ...face, weights: [1, NaN, 1] }, 'palmar-heel'),
  ).toThrow('Finite');
});

test('one fixed source AABB sphere fit is order independent and not target tuned', async () => {
  const { fitSourceSphere } = await import(
    '../../tools/assets/sourceContactGeometry'
  );
  const points = [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
  ];
  const fit = fitSourceSphere(points);
  expect(fit).toEqual({
    kind: 'sphere',
    center: { x: 0, y: 1, z: 0 },
    radiusM: Math.SQRT2 + 1e-7,
  });
  expect(fitSourceSphere([...points].reverse())).toEqual(fit);
  expect(() => fitSourceSphere([])).toThrow();
  expect(() => fitSourceSphere([{ x: 0, y: 0, z: 0 }])).toThrow();
});

const fixtureInput = () => ({
  ...source(),
  candidateBytes: readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/recipe.json.fixture',
  ),
});

test('pinned punch fixture exposes five distinct unaccepted diagnostic impacts without transferring Uppercut allowances', async () => {
  const { loadGroundedPunchDiagnostics } = await import(
    '../../tools/assets/groundedPunchDiagnostic'
  );
  const entries = loadGroundedPunchDiagnostics(fixtureInput());
  expect(entries.map((entry) => entry.asset.definition.impacts.length)).toEqual(
    [4, 1],
  );
  for (const entry of entries) {
    expect(entry.usage).toBe('diagnostic-broadphase-only');
    expect(entry.acceptance).toBeNull();
    expect(entry.gameplayAllowance).toBeNull();
    expect(Object.isFrozen(entry.asset.definition.impacts)).toBe(true);
    expect(
      entry.asset.definition.rootCurve.every((key) => key.position.y === 0),
    ).toBe(true);
    expect(entry.regions.length).toBe(entry.asset.shapes.length);
    for (const region of entry.regions) {
      expect(region.polygons.length).toBeGreaterThan(0);
      expect(region.seed.radiusM).toBeGreaterThan(0);
    }
  }
  expect(
    entries[0]?.finiteMeasurement[2]?.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0);
  expect(
    entries[1]?.finiteMeasurement[0]?.maximumFiniteSurfaceEscapeM,
  ).toBeGreaterThan(0);
});

test('punch fixture fails closed on altered source, manifest, candidate and recipe with no caller pin override', async () => {
  const { loadGroundedPunchDiagnostics } = await import(
    '../../tools/assets/groundedPunchDiagnostic'
  );
  for (const field of [
    'sourceBytes',
    'manifestBytes',
    'candidateBytes',
    'recipeBytes',
  ] as const) {
    const input = fixtureInput();
    input[field][12] = (input[field][12] ?? 0) ^ 1;
    expect(() => loadGroundedPunchDiagnostics(input)).toThrow(/hash|pin/i);
  }
});

test('public catalog keeps all source peaks including interval-end peaks and excludes each half-open endpoint', async () => {
  const { loadGroundedPunchDiagnostics } = await import(
    '../../tools/assets/groundedPunchDiagnostic'
  );
  const { createMotionCatalog } = await import('../../src/assets');
  const { durationMs } = await import('../../src/contracts');
  const entries = loadGroundedPunchDiagnostics(fixtureInput());
  const catalog = createMotionCatalog(async () =>
    entries.map((entry) => entry.asset),
  );
  try {
    await catalog.prepare(new AbortController().signal);
    for (const entry of entries)
      for (const event of entry.descriptor.events) {
        const peak = event.window.peakMs;
        expect(
          catalog
            .sampleMotion(
              entry.descriptor.clipId,
              durationMs(peak),
              durationMs(peak + 0.001),
            )
            ?.hitVolumeSegments.map((segment) => segment.impactIndex),
        ).toContain(event.impactIndex);
        const before = catalog.sampleMotion(
          entry.descriptor.clipId,
          durationMs(event.window.startMs - 0.001),
          durationMs(event.window.startMs),
        );
        const after = catalog.sampleMotion(
          entry.descriptor.clipId,
          durationMs(event.window.endMs),
          durationMs(event.window.endMs + 0.001),
        );
        expect(before?.hitVolumeSegments).toHaveLength(0);
        expect(after?.hitVolumeSegments).toHaveLength(0);
      }
  } finally {
    catalog.dispose();
  }
});

test('deterministic source-only regeneration is byte-identical to the untouched initial five-event candidate', async () => {
  const { bakeGroundedPunchDiagnostics } = await import(
    '../../tools/assets/bakeGroundedPunchDiagnostics'
  );
  const generated = await bakeGroundedPunchDiagnostics(source());
  expect(
    Buffer.from(`${JSON.stringify(generated, null, 2)}\n`).equals(
      fixtureInput().candidateBytes,
    ),
  ).toBe(true);
});

test('companion references are explicitly rejected at the legacy reconstruction boundary', async () => {
  const { loadGroundedPunchDiagnostics } = await import(
    '../../tools/assets/groundedPunchDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/grounded-punches-v1/recipe.json.fixture',
  );
  const args = { ...source(), candidateBytes, recipeBytes };
  const before = Buffer.from(candidateBytes);
  const baseline = loadGroundedPunchDiagnostics(args);
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
    expect(() => loadGroundedPunchDiagnostics(args)).toThrow(
      /additional.*shape|companion/i,
    );
  } finally {
    spy.mockRestore();
  }
  expect(candidateBytes.equals(before)).toBe(true);
  expect(JSON.stringify(loadGroundedPunchDiagnostics(args))).toBe(
    JSON.stringify(baseline),
  );
});
