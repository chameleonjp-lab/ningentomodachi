import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});

it('pins all four authored source events and exact accessor cells with native XYZ', async () => {
  expect(existsSync('tools/assets/kickChainDiagnostic.ts')).toBe(true);
  const { readKickChainSource } = await import(
    '../../tools/assets/kickChainDiagnostic'
  );
  const clip = readKickChainSource(input());
  expect(clip.clipId).toBe('KungFuKickChain4');
  expect(clip.sourceTimesSeconds).toHaveLength(191);
  expect(clip.durationMs).toBe(4244.444370269775);
  expect(
    clip.events.map((e) => [
      e.impactIndex,
      e.side,
      e.sourceEventId,
      e.sourceFrames,
      e.peakFrame,
    ]),
  ).toEqual([
    [0, 'L', 'S6_chain_02_front', [24, 28], 26],
    [1, 'R', 'S6_chain_04_side', [64, 68], 66],
    [2, 'L', 'S6_chain_06_crescent', [106, 118], 113],
    [3, 'R', 'S6_chain_08_continuation', [158, 162], 160],
  ]);
  expect(
    clip.events.map((e) => [e.window.startMs, e.window.endMs, e.window.peakMs]),
  ).toEqual([
    [533.3333611488342, 644.4444060325623, 577.7778029441833],
    [1422.2222566604614, 1533.3333015441895, 1466.6666984558105],
    [2355.555534362793, 2644.444465637207, 2511.11102104187],
    [3511.111259460449, 3622.2221851348877, 3555.555582046509],
  ]);
  expect(clip.events[2]?.surfaceOrigin).toBe(
    'developer-hypothesis-not-source-surface',
  );
  expect(clip.rootPolicy.mode).toBe('in-place-posture-xyz');
  expect(clip.acceptance).toBeNull();
  expect(Object.isFrozen(clip.events)).toBe(true);
});

it('fails closed on source, recipe and unpinned candidate rather than widening trust', async () => {
  expect(existsSync('tools/assets/kickChainDiagnostic.ts')).toBe(true);
  const {
    readKickChainSource,
    validateKickChainRecipe,
    loadKickChainDiagnostic,
  } = await import('../../tools/assets/kickChainDiagnostic');
  expect(() =>
    readKickChainSource({ ...input(), sourceBytes: new Uint8Array() }),
  ).toThrow(/hash/);
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/kungfu-kick-chain-v1/recipe.json.fixture',
  );
  expect(validateKickChainRecipe(recipeBytes).events).toHaveLength(4);
  expect(() =>
    validateKickChainRecipe(Buffer.concat([recipeBytes, Buffer.from(' ')])),
  ).toThrow(/hash/);
  expect(() =>
    loadKickChainDiagnostic({
      ...input(),
      recipeBytes,
      candidateBytes: Buffer.from('{}'),
    }),
  ).toThrow(/hash|unavailable/);
});

it('keeps index2 new edge separate and index3 strictly heel-only', async () => {
  expect(existsSync('tools/assets/bakeKickChainDiagnostics.ts')).toBe(true);
  const { kickChainRegions } = await import(
    '../../tools/assets/bakeKickChainDiagnostics'
  );
  expect([0, 1, 2, 3].map(kickChainRegions)).toEqual([
    ['heel-hypothesis', 'sole-hypothesis'],
    ['heel-hypothesis', 'sole-hypothesis'],
    ['left-outer-foot-edge-hypothesis'],
    ['heel-hypothesis'],
  ]);
  expect(() => kickChainRegions(4)).toThrow();
  expect(() => kickChainRegions(-1)).toThrow();
});

it('clips original heel/sole and mesh-frame outer edge without side or normal substitutions', async () => {
  expect(existsSync('tools/assets/bakeKickChainDiagnostics.ts')).toBe(true);
  const { clipKickChainTriangle } = await import(
    '../../tools/assets/bakeKickChainDiagnostics'
  );
  const face = {
    positions: [
      { x: 0.25, y: 0.02, z: -0.05 },
      { x: 0.26, y: 0.02, z: -0.05 },
      { x: 0.25, y: 0.03, z: -0.04 },
    ],
    normals: Array.from({ length: 3 }, () => ({ x: 0.4, y: -0.4, z: -0.4 })),
    footWeights: [1, 1, 1],
    toeWeights: [0, 0, 0],
  };
  expect(clipKickChainTriangle(face, 'heel-hypothesis', 0.2)).toHaveLength(3);
  expect(clipKickChainTriangle(face, 'sole-hypothesis', 0.2)).toHaveLength(3);
  expect(
    clipKickChainTriangle(face, 'left-outer-foot-edge-hypothesis', 0.2),
  ).toHaveLength(3);
  expect(
    clipKickChainTriangle(
      { ...face, footWeights: [0, 0, 0], toeWeights: [1, 1, 1] },
      'heel-hypothesis',
      0.2,
    ),
  ).toHaveLength(0);
  expect(
    clipKickChainTriangle(face, 'left-outer-foot-edge-hypothesis', 0.24),
  ).toHaveLength(0);
  expect(() => clipKickChainTriangle(face, 'unknown' as never, 0.2)).toThrow();
  expect(() =>
    clipKickChainTriangle(
      { ...face, footWeights: [NaN, 1, 1] },
      'heel-hypothesis',
      0.2,
    ),
  ).toThrow();
});

it('uses exactly the fixed source Z capsule axis with no PCA or sphere alternate', async () => {
  expect(existsSync('tools/assets/bakeKickChainDiagnostics.ts')).toBe(true);
  const { fitKickChainCapsule } = await import(
    '../../tools/assets/bakeKickChainDiagnostics'
  );
  const shape = fitKickChainCapsule([
    { x: -0.02, y: -0.01, z: -0.2 },
    { x: 0.02, y: 0.01, z: 0.2 },
  ]);
  expect(shape.kind).toBe('capsule');
  expect(shape.start.x).toBe(shape.end.x);
  expect(shape.start.y).toBe(shape.end.y);
  expect(shape.start.z).toBeLessThan(shape.end.z);
  expect(() => fitKickChainCapsule([])).toThrow();
});

it('requires exact two-stage Float32 correspondence for all191 keys and rejects a late one-ULP mutation', async () => {
  const module = await import('../../tools/assets/kickChainDiagnostic');
  expect('kickChainAccessorWindow' in module).toBe(true);
  const { inspectGlb } = await import('../../src/assets');
  const clip = inspectGlb(input().sourceBytes).clips.find(
    (c) => c.name === 'KungFuKickChain4',
  );
  if (!clip) throw new Error('Missing pinned source');
  const times = clip.sampleTimes;
  expect(times).toHaveLength(191);
  expect(
    times.every((t, i) =>
      Object.is(t, Math.fround(Math.fround((i + 1) / 30) / 1.5)),
    ),
  ).toBe(true);
  expect(times.filter((t, i) => t !== Math.fround((i + 1) / 45))).toHaveLength(
    52,
  );
  expect(
    times.filter((t, i) => Math.abs(t - ((times[0] ?? 0) + i / 45)) > 2e-7),
  ).toHaveLength(8);
  const { kickChainAccessorWindow } = module;
  const window = kickChainAccessorWindow(
    times,
    158,
    162,
    160,
    clip.durationSeconds * 1000,
  );
  expect(window.initialHoldEndMs).toBe(22.22222276031971);
  expect(window.endMs).toBe(3622.2221851348877);
  const bad = [...times],
    storage = new ArrayBuffer(4),
    floats = new Float32Array(storage),
    bits = new Uint32Array(storage);
  floats[0] = bad[186] ?? 0;
  bits[0] = (bits[0] ?? 0) + 1;
  bad[186] = floats[0] ?? 0;
  expect(() =>
    kickChainAccessorWindow(bad, 158, 162, 160, clip.durationSeconds * 1000),
  ).toThrow(/correspondence/);
  expect(() =>
    kickChainAccessorWindow(
      times.slice(1),
      158,
      162,
      160,
      clip.durationSeconds * 1000,
    ),
  ).toThrow(/cardinality/);
  expect(() =>
    kickChainAccessorWindow(times, 0, 1, 1, clip.durationSeconds * 1000),
  ).toThrow();
  expect(() =>
    kickChainAccessorWindow(times, 189, 191, 190, clip.durationSeconds * 1000),
  ).toThrow();
  expect(() => kickChainAccessorWindow(times, 158, 162, 160, 1)).toThrow();
});

it('loads the exact initial four-capsule candidate without promoting raw escapes or regions', async () => {
  const { loadKickChainDiagnostic } = await import(
    '../../tools/assets/kickChainDiagnostic'
  );
  const candidateBytes = readFileSync(
    'tests/assets/fixtures/kungfu-kick-chain-v1/candidate.json.fixture',
  );
  const recipeBytes = readFileSync(
    'tests/assets/fixtures/kungfu-kick-chain-v1/recipe.json.fixture',
  );
  const entries = loadKickChainDiagnostic({
    ...input(),
    candidateBytes,
    recipeBytes,
  });
  expect(entries).toHaveLength(1);
  const raw = JSON.parse(candidateBytes.toString());
  const r = raw.results[0];
  expect(
    r.asset.definition.impacts.map(
      (x: { damageShare: number }) => x.damageShare,
    ),
  ).toEqual([0.25, 0.25, 0.25, 0.25]);
  expect(
    r.regions.map((x: { polygons: unknown[] }) => x.polygons.length),
  ).toEqual([155, 152, 171, 88]);
  expect(
    r.finiteMeasurement.every(
      (x: { maximumFiniteSurfaceEscapeM: number }) =>
        x.maximumFiniteSurfaceEscapeM > 0,
    ),
  ).toBe(true);
  expect(r.acceptance).toBeNull();
  expect(r.continuousContainment).toBeNull();
  expect(r.gameplayAllowance).toBeNull();
});
