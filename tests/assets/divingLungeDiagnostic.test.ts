/** Source-zero gate: binary parsing and pure policy/timetable checks only.
 * No GLTFLoader, AnimationMixer, mesh evaluation, fixture generation, or playback.
 * Regression targets: retimed clock truncation, invented windows, grounded aerial
 * ownership, endpoint reset, unpinned source, and unbounded sampler invocation.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const sourcePath =
  'assets/android/motions/completed42-speed15/punch/android_punch.glb';
const manifestPath =
  'assets/android/motions/completed42-speed15/punch/manifest.json';
const input = () => ({
  sourceBytes: readFileSync(sourcePath),
  manifestBytes: readFileSync(manifestPath),
});
async function api() {
  expect(
    existsSync('tools/assets/divingLungeDiagnostic.ts'),
    'source-zero diagnostic reader must exist',
  ).toBe(true);
  return import('../../tools/assets/divingLungeDiagnostic');
}
const hash64 = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};

test('source0 pins exact original DivingLunge bytes and preserves its authored single fist event', async () => {
  const { readDivingLungeSource, DIVING_LUNGE_SOURCE_PINS } = await api();
  expect(DIVING_LUNGE_SOURCE_PINS).toEqual({
    sourcePath,
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestPath,
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
  });
  const d = readDivingLungeSource(input());
  expect(d.clipId).toBe('DivingLunge');
  expect(d.sourceClipPointer).toBe('/clips/6');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    impactIndex: 0,
    boneName: 'hand.R',
    sourceFrames: [30, 36],
    peakFrame: 33,
    sourceEventPointer: '/clips/6/attack_and_timeline_events/attack_events/0',
    windowOrigin: 'source-authored-inclusive-frame-range',
    intendedRegion: 'distal-hand-proximal-finger-rim-hypothesis',
    acceptance: null,
    sourceEvent: {
      type: 'low forward aerial straight fist',
      limb: 'hand.R',
      frames: [30, 36],
      peak_frame: 33,
      count: 1,
    },
  });
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
});

test('source0 preserves native positive initial hold and labels half-open interpretation as provisional', async () => {
  const { readDivingLungeSource, validateDivingLungeAccessorTimes } =
    await api();
  const d = readDivingLungeSource(input());
  const event = d.events[0];
  if (!event) throw new Error('Missing required source event');
  expect(d.sourceTimesSeconds).toHaveLength(85);
  expect(d.durationMs).toBe(1888.8888359069824);
  expect(d.sourceTimesSeconds[0]).toBe(0.02222222276031971);
  expect(event.window).toMatchObject({
    policy: 'inclusive-accessor-frame-cells-v1',
    acceptance: 'provisional-policy',
    initialHoldEndMs: 22.22222276031971,
    startMs: 666.6666865348816,
    peakMs: 733.3333492279053,
    endMs: 822.2222328186035,
  });
  expect(d.timeProvenance).toEqual({
    animationPointer: '/animations/6',
    fullTimeAccessorPointer: '/accessors/1641',
    endpointAccessorPointer: '/accessors/1644',
    nativeTimesSha256:
      'c379599d5bdf86b23b1fdfb1a06f1061322f4a1758951760c0f1637d6baf341b',
  });
  expect(() =>
    validateDivingLungeAccessorTimes(d.sourceTimesSeconds),
  ).not.toThrow();
  const changed = [...d.sourceTimesSeconds];
  const original = changed[32];
  if (original === undefined) throw new Error('Missing mutation key');
  changed[32] = original + 0.00000001;
  expect(() => validateDivingLungeAccessorTimes(changed)).toThrow();
  expect(() =>
    validateDivingLungeAccessorTimes(d.sourceTimesSeconds.slice(1)),
  ).toThrow();
});

test('source0 rejects source or manifest mutation before any geometry exists', async () => {
  const { readDivingLungeSource } = await api();
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const data = input();
    data[field] = Buffer.from(data[field]);
    const original = data[field][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    data[field][100] = original ^ 1;
    expect(() => readDivingLungeSource(data)).toThrow(/hash/i);
  }
});

test('source0 labels full XYZ authored transport as diagnostic and retains slide and pivot warnings', async () => {
  const { readDivingLungeSource } = await api();
  const d = readDivingLungeSource(input());
  expect(d.rootPolicy).toMatchObject({
    mode: 'full-translation',
    clipId: 'DivingLunge',
    provenance: {
      clipPointer: '/clips/6',
      supportPointer: '/clips/6/support_contacts/support_phases',
    },
  });
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.sourceRoot.pivot_requirement).toContain(
    'raw root-head translation is not the pelvis path',
  );
  expect(d.sourceRoot.root_motion.end_reset).toBe(false);
  expect(d.sourceSupport.support_phases[2]).toMatchObject({
    frames: [16, 42],
    support: [],
  });
  expect(d.sourceSupport.support_phases[3]).toMatchObject({
    frames: [43, 56],
    support: ['foot.R', 'foot.L'],
  });
  const slide = d.sourceSupport.support_phases[3];
  if (!slide) throw new Error('Missing slide phase');
  expect(slide.behavior).toContain('Intentional decelerating two-foot slide');
  expect(Object.isFrozen(d)).toBe(true);
  expect(Object.isFrozen(d.ownership[0])).toBe(true);
});

test('source0 freezes separate unique candidate and parity timetables without evaluating a pose', async () => {
  const { readDivingLungeSource, planDivingLungeTimetables } = await api();
  const d = readDivingLungeSource(input());
  const event = d.events[0];
  if (!event) throw new Error('Missing required source event');
  const p = planDivingLungeTimetables(d);
  expect(p.candidateTimesMs).toHaveLength(538);
  expect(hash64(p.candidateTimesMs)).toBe(
    '48abe1c2bc279dd21f9fc7f49ee6f6d36db30e2d971423ae2da07414d5dab4cc',
  );
  expect(p.parityTimesMs).toHaveLength(171);
  expect(hash64(p.parityTimesMs)).toBe(
    '3ab94358e3b2f1c79023868fa0dd35a2eb2f6c330f0d14ad20fa6208dc99ae3d',
  );
  expect(p.activeFitTimesMs).toHaveLength(45);
  expect(
    p.activeFitTimesMs.every(
      (t) => t >= event.window.startMs && t <= event.window.endMs,
    ),
  ).toBe(true);
  for (const times of [
    p.candidateTimesMs,
    p.parityTimesMs,
    p.activeFitTimesMs,
  ]) {
    expect(Object.isFrozen(times)).toBe(true);
    expect(new Set(times).size).toBe(times.length);
    expect(
      times.every(
        (t, i) =>
          Number.isFinite(t) && (i === 0 || t > (times[i - 1] ?? Infinity)),
      ),
    ).toBe(true);
  }
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/diving-lunge-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/diving-lunge-v1/recipe.json.fixture',
  ),
});

test('source-free fixture loader pins actual candidate and preserves positive finite escape without qualification', async () => {
  const { loadDivingLungeDiagnostic, DIVING_LUNGE_DIAGNOSTIC_PINS } =
    await api();
  expect(DIVING_LUNGE_DIAGNOSTIC_PINS).toEqual({
    candidateSha256:
      '54ea4f400d3614929f032a3a45fb54d8ab63080e0d09ce0ab2896ce615b12c69',
    recipeSha256:
      '00b5b44a46da3d7769c3d08d727de1c04862592f477782bc0cc42a8e6c0672aa',
  });
  const entry = loadDivingLungeDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('DivingLunge');
  expect(entry.asset.definition.rootCurve).toHaveLength(538);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.asset.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  const measurement = entry.finiteMeasurement[0];
  if (!measurement) throw new Error('Missing pinned measurement');
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(8.563321155646841e-8);
  expect(measurement.probes).toBe(177);
  expect(measurement.testedCorners).toBe(269748);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.supportMeasurementStatus).toContain(
    'signed support clearance not measured',
  );
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});

test('source-free fixture loader rejects altered candidate and recipe bytes', async () => {
  const { loadDivingLungeDiagnostic } = await api();
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    input[key][100] = original ^ 1;
    expect(() => loadDivingLungeDiagnostic(input)).toThrow(/hash/i);
  }
});
