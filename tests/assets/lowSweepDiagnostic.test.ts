/** LowSweep diagnostic metadata tests. Read original bytes, never pose original sources. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const api = () => import('../../tools/assets/lowSweepDiagnostic');
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
test('source0 pins original LowSweep generic right-leg event and provisional native window', async () => {
  const { readLowSweepSource, LOW_SWEEP_SOURCE_PINS } = await api();
  expect(LOW_SWEEP_SOURCE_PINS.sourceSha256).toBe(
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  );
  expect(LOW_SWEEP_SOURCE_PINS.manifestSha256).toBe(
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  );
  const d = readLowSweepSource(input());
  expect(d.clipId).toBe('LowSweep');
  expect(d.durationMs).toBe(1222.2222089767456);
  expect(d.initialHoldMs).toBe(22.22222276031971);
  expect(d.runtimePlaybackMultiplier).toBe(1);
  expect(d.events).toHaveLength(1);
  expect(d.events[0]?.sourceFrames).toEqual([20, 33]);
  expect(d.events[0]?.peakFrame).toBe(29);
  expect(d.events[0]?.sourceEventPointer).toBe(
    '/clips/3/attack_and_timeline_events/attack_events/0',
  );
  expect(d.events[0]?.window).toMatchObject({
    startMs: 444.4444477558136,
    endMs: 755.5555701255798,
    peakMs: 644.4444060325623,
    acceptance: 'provisional-policy',
  });
  expect(d.events[0]?.sourceEvent).toMatchObject({
    type: 'low right leg sweep',
    frames: [20, 33],
    impact_frame: 29,
  });
});
test('source0 rejects changed original GLB or manifest bytes', async () => {
  const { readLowSweepSource } = await api();
  for (const key of ['sourceBytes', 'manifestBytes'] as const) {
    const bytes = input();
    const old = bytes[key][100];
    if (old === undefined) throw new Error('Mutation byte required');
    bytes[key][100] = old ^ 1;
    expect(() => readLowSweepSource(bytes)).toThrow(/hash/i);
  }
});
test('source0 rejects relabeled or reordered native clock', async () => {
  const { readLowSweepSource, validateLowSweepAccessorTimes } = await api();
  const d = readLowSweepSource(input());
  expect(() =>
    validateLowSweepAccessorTimes(d.sourceTimesSeconds),
  ).not.toThrow();
  expect(() =>
    validateLowSweepAccessorTimes(d.sourceTimesSeconds.map((_, i) => i / 45)),
  ).toThrow();
  const changed = [...d.sourceTimesSeconds];
  changed.reverse();
  expect(() => validateLowSweepAccessorTimes(changed)).toThrow();
});
test('source0 preserves native XYZ and Y rotation with provisional anterior-shin coverage', async () => {
  const { readLowSweepSource } = await api();
  const d = readLowSweepSource(input());
  expect(d.nativeRootRotation).toMatchObject({
    accessorPointer: '/accessors/4205',
    interpolation: 'LINEAR',
    pureAxisReconstruction: false,
  });
  expect(d.nativeRootRotation.quaternions).toHaveLength(55);
  expect(d.nativeRootTranslation.net).toEqual([0, 0, 0]);
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.sourcePhases.phase_frames).toMatchObject({
    extension: 20,
    impact: 29,
    follow_through: 33,
    reset: 55,
  });
  expect(d.shinRegion).toMatchObject({
    region: 'anterior-shin-hypothesis',
    sourceAuthoredSubregion: false,
    regionUnion: false,
    visualAcceptance: null,
    consistentlyLeadingSurfaceAcceptance: null,
    inspectionReceiptSha256:
      'd0f1770ae5a8df9f0c13678b3a66d609d25681c0aa2ce9ea5a666d6cac0901f3',
    helperSha256:
      'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013',
    inspectionSourceUpdates: 28,
  });
  expect(d.shinRegion.normalMotionReversal).toEqual({
    frame27: 0.6474632989381525,
    peakFrame29: -0.48948340426569775,
    resolved: false,
  });
  expect(d.shinRegion.predicates).toEqual({
    shinWeightMin: 0.5,
    shinYMin: 0.08,
    shinYMax: 0.36,
    shinZMax: -0.035,
    shinNormalZMax: -0.25,
  });
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(Object.isFrozen(d)).toBe(true);
});
test('source0 freezes separate candidate and parity proposals without execution authority', async () => {
  const { readLowSweepSource, planLowSweepTimetables } = await api();
  const p = planLowSweepTimetables(readLowSweepSource(input()));
  for (const [times, count, hash] of [
    [
      p.candidateTimesMs,
      348,
      '1b475925c323b9b316be462534fb8cb947e387652399af29c4370c0248a96834',
    ],
    [
      p.activeFitTimesMs,
      90,
      '0b7192a03e80f25634a8913d469e1c0096fb2ed524e5cea64cb039549262b512',
    ],
    [
      p.enclosureTimesMs,
      357,
      'fe98f175dd6d052a618772a5f3c5b887cb00f790828fd43daf63d5c9419bf50d',
    ],
    [
      p.parityTimesMs,
      111,
      '6790387e5e8c92b4ecb8133afcefa027a5e028645f3c862e5f056abc5eb3df05',
    ],
  ] as const) {
    expect(times).toHaveLength(count);
    expect(hash64(times)).toBe(hash);
    expect(new Set(times).size).toBe(times.length);
    expect(Object.isFrozen(times)).toBe(true);
  }
  expect(p.attemptedCandidateMixerCalls).toBe(797);
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/low-sweep-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/low-sweep-v1/recipe.json.fixture',
  ),
});
test('source-free fixture preserves provisional shin coverage, sphere-equivalent proxy and signed unqualified measurements', async () => {
  const { loadLowSweepDiagnostic } = await api();
  const entry = loadLowSweepDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('LowSweep');
  expect(entry.asset.definition.rootCurve).toHaveLength(348);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.regions[0]?.polygons).toHaveLength(233);
  expect(entry.rawRootCurve.at(-1)?.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(Math.min(...entry.rawRootCurve.map((k) => k.position.y))).toBe(
    -0.475000835955143,
  );
  expect(Math.max(...entry.rawRootCurve.map((k) => k.position.x))).toBe(
    0.2500000298023224,
  );
  expect(Math.min(...entry.rawRootCurve.map((k) => k.visualYawRad))).toBe(
    -0.22000006112313056,
  );
  expect(Math.max(...entry.rawRootCurve.map((k) => k.visualYawRad))).toBe(
    0.39999996003707117,
  );
  const shape = entry.asset.shapes[0];
  if (!shape) throw new Error('Pinned shape required');
  for (const key of shape.keys) {
    expect(key.volume.kind).toBe('capsule');
    if (key.volume.kind !== 'capsule') throw new Error('Capsule required');
    expect(key.volume.start).toEqual(key.volume.end);
  }
  const measurement = entry.finiteMeasurement[0];
  if (!measurement) throw new Error('Pinned measurement required');
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(-9.033818987314035e-8);
  expect(measurement.probes).toBe(357);
  expect(measurement.testedCorners).toBe(269892);
  expect(
    measurement.directionalExcess.find((row) => row.axis === '+Z')?.maximumM,
  ).toBe(0.1226016398576954);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.descriptor.shinRegion.normalMotionReversal.resolved).toBe(false);
  expect(entry.descriptor.shinRegion.sourceAuthoredSubregion).toBe(false);
  expect(
    entry.descriptor.shinRegion.consistentlyLeadingSurfaceAcceptance,
  ).toBeNull();
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.supportMeasurementStatus).toContain(
    'No floor/sole-clearance claim',
  );
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});
test('source-free fixture loader rejects altered candidate and recipe bytes', async () => {
  const { loadLowSweepDiagnostic } = await api();
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Mutation byte required');
    input[key][100] = original ^ 1;
    expect(() => loadLowSweepDiagnostic(input)).toThrow(/hash/i);
  }
});
