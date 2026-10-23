/** Source-zero only: pins, binary timestamps, authored semantics and proposals.
 * Regression targets: phase broadening, sole fallback, rotation reset, grounding,
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
    existsSync('tools/assets/spinningAttackDiagnostic.ts'),
    'source-zero reader must exist',
  ).toBe(true);
  return import('../../tools/assets/spinningAttackDiagnostic');
}
const hash64 = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};

test('source0 pins one authored heel-led strike without broadening to the phase end', async () => {
  const { readSpinningAttackSource, SPINNING_ATTACK_SOURCE_PINS } = await api();
  expect(SPINNING_ATTACK_SOURCE_PINS).toEqual({
    sourcePath,
    manifestPath,
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  });
  const d = readSpinningAttackSource(input());
  expect(d.sourceClipPointer).toBe('/clips/5');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'foot.R',
    sourceFrames: [39, 43],
    peakFrame: 43,
    sourceEventPointer: '/clips/5/attack_and_timeline_events/strikes/0',
    intendedRegion: 'heel-only-hypothesis',
    sourceEvent: {
      type: 'heel-led aerial spinning side kick',
      extension_window: [39, 43],
      impact_frame: 43,
    },
    acceptance: null,
  });
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
});

test('source0 preserves positive native hold and exact half-open accessor cells', async () => {
  const { readSpinningAttackSource, validateSpinningAttackAccessorTimes } =
    await api();
  const d = readSpinningAttackSource(input());
  expect(d.sourceTimesSeconds).toHaveLength(88);
  expect(d.durationMs).toBe(1955.5555582046509);
  expect(d.events[0]?.window).toMatchObject({
    startMs: 866.6666150093079,
    peakMs: 955.5554986000061,
    endMs: 977.7777791023254,
    initialHoldEndMs: 22.22222276031971,
    acceptance: 'provisional-policy',
  });
  expect(d.timeProvenance).toMatchObject({
    animationPointer: '/animations/5',
    fullTimeAccessorPointer: '/accessors/353',
    endpointAccessorPointer: '/accessors/356',
    nativeTimesSha256:
      '486f31b8ffd8fe0f29b041f44d6d2881c07bc633e7e6984d7794103ac92f1e31',
  });
  const changed = [...d.sourceTimesSeconds];
  const original = changed[42];
  if (original === undefined) throw new Error('Missing mutation key');
  changed[42] = original + 0.00000001;
  expect(() => validateSpinningAttackAccessorTimes(changed)).toThrow();
});

test('source0 rejects changed original source bytes and changed manifest', async () => {
  const { readSpinningAttackSource } = await api();
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const data = input();
    data[field] = Buffer.from(data[field]);
    const original = data[field][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    data[field][100] = original ^ 1;
    expect(() => readSpinningAttackSource(data)).toThrow(/hash/i);
  }
});

test('source0 retains full XYZ transport and authored continuous spin without grounding or reset', async () => {
  const { readSpinningAttackSource } = await api();
  const d = readSpinningAttackSource(input());
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.sourceRoot.root_motion.unwrapped_rotation_degrees).toEqual({
    start: 0,
    windup: 22,
    takeoff: -6,
    first_landing: -360,
    end: -360,
  });
  expect(d.sourcePhases.airborne).toMatchObject({
    planned_frames: [21, 53],
    body_grounded_correction_used: false,
  });
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.heelRegion).toMatchObject({
    region: 'heel',
    helperPath: 'tools/assets/bakeGroundedKickDiagnostics.ts',
    helperSha256:
      '4ee6c17746d26643c8234016543ad4bef53f57f7f71391e41070d3467877e940',
    soleFallback: false,
    visualAcceptance: null,
  });
  expect(Object.isFrozen(d)).toBe(true);
});

test('source0 freezes separate proposed schedules without source execution authority', async () => {
  const { readSpinningAttackSource, planSpinningAttackTimetables } =
    await api();
  const p = planSpinningAttackTimetables(readSpinningAttackSource(input()));
  for (const [times, count, hash] of [
    [
      p.candidateTimesMs,
      557,
      '242f38bda8bf75a6fd5e06eee0228bc014a826a61cd6985730dc4c75807d92d6',
    ],
    [
      p.activeFitTimesMs,
      33,
      '40f104e1d80cd61ce4936fd06ada3af88da3546e47d488ead1268fb7bd81fec4',
    ],
    [
      p.parityTimesMs,
      177,
      'd1291fd6422d59a4695060231b497e6c8b469acf8390576a9f471c04c6088f22',
    ],
    [
      p.enclosureTimesMs,
      129,
      'ed606840cdb8265e61618daa9a3896134fe860ee1b2598a6f4eacb16f9229682',
    ],
  ] as const) {
    expect(times).toHaveLength(count);
    expect(hash64(times)).toBe(hash);
    expect(Object.isFrozen(times)).toBe(true);
    expect(new Set(times).size).toBe(times.length);
  }
  expect(p.attemptedCandidateMixerCalls).toBe(721);
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/spinning-attack-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/spinning-attack-v1/recipe.json.fixture',
  ),
});

test('source-free fixture loader pins actual candidate and preserves positive finite escape without qualification', async () => {
  const { loadSpinningAttackDiagnostic, SPINNING_ATTACK_DIAGNOSTIC_PINS } =
    await api();
  expect(SPINNING_ATTACK_DIAGNOSTIC_PINS).toEqual({
    candidateSha256:
      'fe4f782ee3c00e088b911497ba70d861d1cfe6c0448a92208773aeb0a2082ef1',
    recipeSha256:
      '4b336704782127cc39412d152a96cab0a8eea44511f0262e9c393fc34016f1cd',
  });
  const entry = loadSpinningAttackDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('SpinningAttack');
  expect(entry.asset.definition.rootCurve).toHaveLength(557);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.rawRootCurve.at(-1)?.visualYawRad).toBe(-6.283185482025188);
  expect(entry.regions[0]?.polygons).toHaveLength(88);
  expect(
    entry.regions[0]?.polygons.every((polygon) => polygon.region === 'heel'),
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
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(0.00030398659263217165);
  expect(measurement.probes).toBe(129);
  expect(measurement.testedCorners).toBe(36765);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.supportMeasurementStatus).toContain(
    'signed foot/toe minima not measured',
  );
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});

test('source-free fixture loader rejects altered candidate and recipe bytes', async () => {
  const { loadSpinningAttackDiagnostic } = await api();
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    input[key][100] = original ^ 1;
    expect(() => loadSpinningAttackDiagnostic(input)).toThrow(/hash/i);
  }
});
