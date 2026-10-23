/** Source-zero only: pins, binary timestamps, authored semantics and proposals.
 * Regression targets: phase broadening, heel fallback, rotation reset, grounding,
 * source mutation and unbounded timetable. No source evaluator is invoked.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const sourcePath =
  'assets/android/motions/completed42-speed15/kick/android_kick.glb';
const manifestPath =
  'assets/android/motions/completed42-speed15/kick/manifest.json';
const input = () => ({
  sourceBytes: readFileSync(sourcePath),
  manifestBytes: readFileSync(manifestPath),
});
async function api() {
  expect(
    existsSync('tools/assets/chineseCartwheelDiagnostic.ts'),
    'source-zero reader must exist',
  ).toBe(true);
  return import('../../tools/assets/chineseCartwheelDiagnostic');
}
const hash64 = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};

test('source0 pins one authored sole strike without broadening to the phase end', async () => {
  const { readChineseCartwheelKickSource, CHINESE_CARTWHEEL_SOURCE_PINS } =
    await api();
  expect(CHINESE_CARTWHEEL_SOURCE_PINS).toEqual({
    sourcePath,
    manifestPath,
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  });
  const d = readChineseCartwheelKickSource(input());
  expect(d.sourceClipPointer).toBe('/clips/16');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'foot.R',
    sourceFrames: [45, 52],
    peakFrame: 49,
    sourceEventPointer: '/clips/16/attack_and_timeline_events/strikes/0',
    intendedRegion: 'sole-only-hypothesis',
    sourceEvent: {
      type: 'inverted cartwheel extension; sole attack',
      window: [45, 52],
      frame: 49,
    },
    acceptance: null,
  });
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
});

test('source0 preserves positive native hold and exact half-open accessor cells', async () => {
  const {
    readChineseCartwheelKickSource,
    validateChineseCartwheelKickAccessorTimes,
  } = await api();
  const d = readChineseCartwheelKickSource(input());
  expect(d.sourceTimesSeconds).toHaveLength(101);
  expect(d.durationMs).toBe(2244.4443702697754);
  expect(d.events[0]?.window).toMatchObject({
    startMs: 1000,
    peakMs: 1088.8888835906982,
    endMs: 1177.7777671813965,
    initialHoldEndMs: 22.22222276031971,
    acceptance: 'provisional-policy',
  });
  expect(d.timeProvenance).toMatchObject({
    animationPointer: '/animations/16',
    fullTimeAccessorPointer: '/accessors/836',
    endpointAccessorPointer: '/accessors/839',
    nativeTimesSha256:
      '4b19b01d5be5d6185408e44b37acbe6cac4dbb5cb3776cbbe02c3658ef0612bb',
  });
  const changed = [...d.sourceTimesSeconds];
  const original = changed[42];
  if (original === undefined) throw new Error('Missing mutation key');
  changed[42] = original + 0.00000001;
  expect(() => validateChineseCartwheelKickAccessorTimes(changed)).toThrow();
});

test('source0 rejects changed original source bytes and changed manifest', async () => {
  const { readChineseCartwheelKickSource } = await api();
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const data = input();
    data[field] = Buffer.from(data[field]);
    const original = data[field][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    data[field][100] = original ^ 1;
    expect(() => readChineseCartwheelKickSource(data)).toThrow(/hash/i);
  }
});

test('source0 preserves quaternion Z roll distinct from yaw and original palm support', async () => {
  const { readChineseCartwheelKickSource } = await api();
  const d = readChineseCartwheelKickSource(input());
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.sourceRoot.root_travel).toMatchObject({
    axis: '+X',
    meters: 2.675,
    end_reset: false,
    continuous_cartwheel_roll_degrees: 360,
  });
  expect(d.nativeRootRotation).toMatchObject({
    accessorPointer: '/accessors/838',
    rawSha256:
      '3f4dde4337ecd676ed9730e9dceff58640876bf7ec1ff0e4069a2301b3096495',
    scalarYawRange: [0, 0],
    rollIsNotYaw: true,
  });
  expect(d.nativeRootRotation.quaternions).toHaveLength(101);
  expect(d.nativeRootRotation.unwrappedZRollRad).toBeCloseTo(
    -6.283185482025138,
    12,
  );
  expect(d.nativeRootTranslation.net).toEqual([2.6750001907348633, 0, 0]);
  expect(d.sourceSupport.contacts).toMatchObject([
    { limb: 'hand.L', frames: [25, 49] },
    { limb: 'hand.R', frames: [42, 63] },
    { limb: 'foot.R', frames: [73, 101] },
    { limb: 'foot.L', frames: [78, 101] },
  ]);
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.soleRegion).toMatchObject({
    region: 'sole',
    helperPath: 'tools/assets/bakeGroundedKickDiagnostics.ts',
    helperSha256:
      '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
    heelFallback: false,
    visualAcceptance: null,
  });
  expect(Object.isFrozen(d)).toBe(true);
});

test('source0 freezes separate proposed schedules without source execution authority', async () => {
  const { readChineseCartwheelKickSource, planChineseCartwheelKickTimetables } =
    await api();
  const p = planChineseCartwheelKickTimetables(
    readChineseCartwheelKickSource(input()),
  );
  for (const [times, count, hash] of [
    [
      p.candidateTimesMs,
      638,
      '23134b6b339b144225594bc1f0109f8fda14ea7ac4bf13ad70b79e36af7755cf',
    ],
    [
      p.activeFitTimesMs,
      51,
      '3e4350e77737fbe5a687ef17c3b1d6d315c99f38a676ad28c2b1db67c2165e47',
    ],
    [
      p.parityTimesMs,
      203,
      '0e6a9c954862ef8634e7fa8b2f04bc172a51092d42c1797b01c67844a31687db',
    ],
    [
      p.enclosureTimesMs,
      201,
      'be03fb8b4d1aa96013fdfbc6dbc9e61f26e813bf0eae10420c51c16dbd38081d',
    ],
  ] as const) {
    expect(times).toHaveLength(count);
    expect(hash64(times)).toBe(hash);
    expect(Object.isFrozen(times)).toBe(true);
    expect(new Set(times).size).toBe(times.length);
  }
  expect(p.attemptedCandidateMixerCalls).toBe(892);
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/chinese-cartwheel-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/chinese-cartwheel-v1/recipe.json.fixture',
  ),
});

test('source-free fixture loader pins actual candidate and preserves positive finite escape without qualification', async () => {
  const {
    loadChineseCartwheelKickDiagnostic,
    CHINESE_CARTWHEEL_DIAGNOSTIC_PINS,
  } = await api();
  expect(CHINESE_CARTWHEEL_DIAGNOSTIC_PINS).toEqual({
    candidateSha256:
      '5f207107e81e6588fdbd4f767c154340cb8c1f22da973b8a38d6be7b9c502c39',
    recipeSha256:
      '42e91847e8efe49827989c9a089588582f43b30165d6707c467c72c9a3db1226',
  });
  const entry = loadChineseCartwheelKickDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('ChineseCartwheelKick');
  expect(entry.asset.definition.rootCurve).toHaveLength(638);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.rawRootCurve.every((key) => key.visualYawRad === 0)).toBe(true);
  expect(entry.rawRootRotationCurve.at(-1)?.zRollRad).toBe(-6.283185482025142);
  expect(entry.rawRootRotationCurve).toHaveLength(638);
  expect(Math.min(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    -0.12321271747350693,
  );
  expect(Math.max(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    2.3098199442029,
  );
  expect(entry.rawRootCurve.at(-1)?.position).toEqual({
    x: 2.6750001907348633,
    y: 0,
    z: 0,
  });
  expect(entry.regions[0]?.polygons).toHaveLength(64);
  expect(
    entry.regions[0]?.polygons.every((polygon) => polygon.region === 'sole'),
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
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(0.0005513237550751546);
  expect(measurement.probes).toBe(201);
  expect(measurement.testedCorners).toBe(39195);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.supportMeasurementStatus).toContain(
    'Signed foot/toe minima not measured',
  );
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});

test('source-free fixture loader rejects altered candidate and recipe bytes', async () => {
  const { loadChineseCartwheelKickDiagnostic } = await api();
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    input[key][100] = original ^ 1;
    expect(() => loadChineseCartwheelKickDiagnostic(input)).toThrow(/hash/i);
  }
});
