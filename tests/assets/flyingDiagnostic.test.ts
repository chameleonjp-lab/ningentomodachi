/** Flying diagnostic metadata tests. Read original bytes, never pose original sources. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const api = () => import('../../tools/assets/flyingDiagnostic');
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const hash64 = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};
test('source0 pins original Flying single-foot event and provisional native window', async () => {
  const { readFlyingSource, FLYING_SOURCE_PINS } = await api();
  expect(FLYING_SOURCE_PINS.sourceSha256).toBe(
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  );
  expect(FLYING_SOURCE_PINS.manifestSha256).toBe(
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  );
  const d = readFlyingSource(input());
  expect(d.clipId).toBe('FlyingKick');
  expect(d.durationMs).toBe(1733.3332300186157);
  expect(d.initialHoldMs).toBe(22.22222276031971);
  expect(d.runtimePlaybackMultiplier).toBe(1);
  expect(d.events).toHaveLength(1);
  expect(d.events[0]?.sourceFrames).toEqual([39, 46]);
  expect(d.events[0]?.peakFrame).toBe(42);
  expect(d.events[0]?.sourceEventPointer).toBe(
    '/clips/14/attack_and_timeline_events/attack_events/0',
  );
  expect(d.events[0]?.window).toMatchObject({
    startMs: 866.6666150093079,
    endMs: 1044.4444417953491,
    peakMs: 933.3333373069763,
    acceptance: 'provisional-policy',
  });
  expect(d.events[0]?.sourceEvent).toMatchObject({
    limb: 'foot.R',
    not_a_knee_strike: true,
    hit_count: 1,
  });
});
test('source0 rejects changed original GLB or manifest bytes', async () => {
  const { readFlyingSource } = await api();
  for (const key of ['sourceBytes', 'manifestBytes'] as const) {
    const bytes = input();
    const old = bytes[key][100];
    if (old === undefined) throw new Error('Mutation byte required');
    bytes[key][100] = old ^ 1;
    expect(() => readFlyingSource(bytes)).toThrow(/hash/i);
  }
});
test('source0 rejects relabeled or reordered native clock', async () => {
  const { readFlyingSource, validateFlyingAccessorTimes } = await api();
  const d = readFlyingSource(input());
  expect(() => validateFlyingAccessorTimes(d.sourceTimesSeconds)).not.toThrow();
  expect(() =>
    validateFlyingAccessorTimes(d.sourceTimesSeconds.map((_, i) => i / 45)),
  ).toThrow();
  const changed = [...d.sourceTimesSeconds];
  changed.reverse();
  expect(() => validateFlyingAccessorTimes(changed)).toThrow();
});
test('source0 preserves native XYZ and identity STEP quaternion with developer-only sole provenance', async () => {
  const { readFlyingSource } = await api();
  const d = readFlyingSource(input());
  expect(d.nativeRootRotation).toMatchObject({
    accessorPointer: '/accessors/2125',
    interpolation: 'STEP',
    quaternions: [
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ],
    unwrappedYawRad: 0,
    pureAxisReconstruction: false,
  });
  expect(d.nativeRootTranslation.net).toEqual([
    0, 1.043081283569336e-7, 2.1600003242492676,
  ]);
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.sourcePhases.airborne).toMatchObject({
    frames: [27, 55],
    no_ground_snap: true,
  });
  expect(d.soleRegion).toMatchObject({
    region: 'sole-hypothesis',
    sourceAuthoredSubregion: false,
    regionUnion: false,
    visualAcceptance: null,
    inspectionReceiptSha256:
      '8aa4b7f1f11eb2172ebf7c9f01b1a404b3df1466b344802f9202fb6ec6db724c',
    helperSha256:
      '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
  });
  expect(d.soleRegion.predicates).toEqual({
    combinedFootToeWeightMin: 0.5,
    bindYMax: 0.035,
    normalYMax: -0.35,
  });
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(Object.isFrozen(d)).toBe(true);
});
test('source0 freezes separate candidate and parity proposals without execution authority', async () => {
  const { readFlyingSource, planFlyingTimetables } = await api();
  const p = planFlyingTimetables(readFlyingSource(input()));
  for (const [times, count, hash] of [
    [
      p.candidateTimesMs,
      493,
      'f68a2e65a3b0fe3ed8a5c325a9acf5bdb5c13686386e80516f3881e44363ef98',
    ],
    [
      p.activeFitTimesMs,
      51,
      '5830de426b91bfcd74387af5a1c95691958f9e94680581b57ebda469dffe4212',
    ],
    [
      p.enclosureTimesMs,
      201,
      '0f4e198d4fac2236b8e8c61048bcc0b432a3d836e838bdc88659df3892c4cc8c',
    ],
    [
      p.parityTimesMs,
      157,
      '04ef39e984ef37d4dac28c38927c9ff8b85d4599040d6a0f455263cc2c1dea22',
    ],
  ] as const) {
    expect(times).toHaveLength(count);
    expect(hash64(times)).toBe(hash);
    expect(new Set(times).size).toBe(times.length);
    expect(Object.isFrozen(times)).toBe(true);
  }
  expect(p.attemptedCandidateMixerCalls).toBe(747);
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/flying-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/flying-v1/recipe.json.fixture',
  ),
});
test('source-free fixtures preserve native identity quaternion and unqualified signed measurements', async () => {
  const { loadFlyingDiagnostic, FLYING_DIAGNOSTIC_PINS } = await import(
    '../../tools/assets/flyingDiagnostic'
  );
  expect(FLYING_DIAGNOSTIC_PINS.candidateSha256).toBe(
    '5a43975832bdea68082e0d3c541c644857a40c007a7cded46dae3ccf1692979a',
  );
  expect(FLYING_DIAGNOSTIC_PINS.recipeSha256).toBe(
    '0f5a992b95fcc6866d0f690d26052cfd10155dc2d5b6147152ef575a27beef47',
  );
  const entry = loadFlyingDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('FlyingKick');
  expect(entry.asset.definition.rootCurve).toHaveLength(493);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.rawRootRotationCurve.at(-1)?.visualYawRad).toBe(0);
  expect(
    entry.rawRootRotationCurve.every(
      (key) =>
        key.quaternion.x === 0 &&
        key.quaternion.y === 0 &&
        key.quaternion.z === 0 &&
        key.quaternion.w === 1,
    ),
  ).toBe(true);
  expect(Math.min(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    -0.2000001221895218,
  );
  expect(Math.max(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    0.7300000637769699,
  );
  expect(entry.rawRootCurve.at(-1)?.position).toEqual({
    x: 0,
    y: 1.043081283569336e-7,
    z: 2.1600003242492676,
  });
  expect(entry.regions[0]?.polygons).toHaveLength(64);
  expect(
    entry.regions[0]?.polygons.every(
      (polygon) => polygon.region === 'sole-hypothesis',
    ),
  ).toBe(true);
  expect(entry.asset.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  const measurement = entry.finiteMeasurement[0];
  if (!measurement) throw new Error('Missing pinned measurement');
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(0.00011977080697794101);
  expect(measurement.probes).toBe(201);
  expect(measurement.testedCorners).toBe(39195);
  expect(
    measurement.directionalExcess.find((row) => row.axis === '-Z')?.maximumM,
  ).toBe(0.05959371558851578);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.supportMeasurementStatus).toContain('no sole-clearance claim');
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});
test('source-free fixture loader rejects altered candidate or recipe bytes', async () => {
  const { loadFlyingDiagnostic } = await import(
    '../../tools/assets/flyingDiagnostic'
  );
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    input[key][100] = original ^ 1;
    expect(() => loadFlyingDiagnostic(input)).toThrow(/hash/i);
  }
});
