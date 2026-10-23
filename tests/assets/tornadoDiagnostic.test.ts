/** Reconstruction dated 2026-10-23T21:17Z from published main e69c98aa.
 * New tests, not recovered historical results. Original metadata parsing only. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  readTornadoSource,
  planTornadoTimetables,
  validateTornadoAccessorTimes,
  TORNADO_SOURCE_PINS,
} from '../../tools/assets/tornadoDiagnostic';
const input = () => ({
  sourceBytes: readFileSync(TORNADO_SOURCE_PINS.sourcePath),
  manifestBytes: readFileSync(TORNADO_SOURCE_PINS.manifestPath),
});
const hash64 = (times: readonly number[]) => {
  const bytes = Buffer.alloc(times.length * 8);
  times.forEach((time, index) => {
    bytes.writeDoubleLE(time, index * 8);
  });
  return createHash('sha256').update(bytes).digest('hex');
};
test('source0 exact original pins and authored instep window remain provisional', () => {
  expect(TORNADO_SOURCE_PINS.sourceSha256).toBe(
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  );
  expect(TORNADO_SOURCE_PINS.manifestSha256).toBe(
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  );
  const d = readTornadoSource(input());
  expect(d.sourceClipPointer).toBe('/clips/13');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'foot.R',
    sourceFrames: [47, 55],
    peakFrame: 51,
    sourceEventPointer: '/clips/13/attack_and_timeline_events/strikes/0',
    intendedRegion: 'instep-hypothesis',
    window: {
      startMs: 1044.4444417953491,
      peakMs: 1133.3333253860474,
      endMs: 1244.444489479065,
      acceptance: 'provisional-policy',
    },
  });
  expect(d.durationMs).toBe(2222.222089767456);
  expect(d.initialHoldMs).toBe(22.22222276031971);
  expect(d.runtimePlaybackMultiplier).toBe(1);
});
test('source0 rejects changed binary and manifest bytes', () => {
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const x = input(),
      byte = x[field][100];
    if (byte === undefined) throw new Error('Required mutation byte');
    x[field][100] = byte ^ 1;
    expect(() => readTornadoSource(x)).toThrow(/hash/i);
  }
});
test('source0 rejects a changed native float32 clock and preserves positive hold', () => {
  const d = readTornadoSource(input());
  expect(d.sourceTimesSeconds).toHaveLength(100);
  const changed = [...d.sourceTimesSeconds],
    value = changed[50];
  if (value === undefined) throw new Error('Required native key');
  changed[50] = value + 1e-8;
  expect(() => validateTornadoAccessorTimes(changed)).toThrow();
});
test('source0 retains mixed quaternion XYZ and exact original shin provenance', () => {
  const d = readTornadoSource(input());
  expect(d.nativeRootRotation.unwrappedYawRad).toBeCloseTo(
    6.283185482025226,
    12,
  );
  expect(
    d.nativeRootRotation.quaternions.some((q) => q[0] !== 0 && q[2] !== 0),
  ).toBe(true);
  expect(d.nativeRootRotation.pureAxisReconstruction).toBe(false);
  expect(d.nativeRootTranslation.net).toEqual([
    0.40000003576278687, -4.470348358154297e-8, 0.850000161677599,
  ]);
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  expect(d.instepRegion).toMatchObject({
    helperSha256:
      'e4c2c5cc0d203fe714ab276a724922ecaca1457148b2cb95fb8d6a09a5cf8013',
    shinJoint: 50,
    footJoint: 51,
    toeJoint: 52,
    inverseBindAccessor: 30,
    fabricatedShinInputs: false,
    regionUnion: false,
    visualAcceptance: null,
  });
  expect(d.sourcePhases.airborne.planned_frames).toEqual([33, 67]);
  expect(d.sourcePhases.airborne.body_grounded_correction_used).toBe(false);
  expect(d.acceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(Object.isFrozen(d)).toBe(true);
});
test('source0 freezes separate proposed schedules without execution permission', () => {
  const p = planTornadoTimetables(readTornadoSource(input()));
  for (const [times, count, hash] of [
    [
      p.candidateTimesMs,
      632,
      'ee94feeb3b7f2da17e46d4a2839d019a7a68a6a95631f0d4b07f59dfe9656155',
    ],
    [
      p.activeFitTimesMs,
      58,
      'f6b9b2b5ab74096ff7467f0c7938a695ff45aa0c2247e6cb8a99c24efaf00500',
    ],
    [
      p.enclosureTimesMs,
      229,
      'fc3fc2756862eced40a6a22d40a10aa74f2832d9527d585e4371c98ca773db07',
    ],
    [
      p.parityTimesMs,
      201,
      '79915c74a4d952b1e687e5140dc0a62998bba3dcb8ad5f70cfeb66ab8827774f',
    ],
  ] as const) {
    expect(times).toHaveLength(count);
    expect(hash64(times)).toBe(hash);
    expect(Object.isFrozen(times)).toBe(true);
  }
  expect(p.attemptedCandidateMixerCalls).toBe(921);
  expect(p.executionAuthorized).toBe(false);
});

const diagnosticInput = () => ({
  candidateBytes: readFileSync(
    'tests/assets/fixtures/tornado-reconstructed-v1/candidate.json.fixture',
  ),
  recipeBytes: readFileSync(
    'tests/assets/fixtures/tornado-reconstructed-v1/recipe.json.fixture',
  ),
});
test('source-free reconstructed fixtures preserve native mixed quaternion and unqualified signed measurements', async () => {
  const { loadTornadoDiagnostic, TORNADO_DIAGNOSTIC_PINS } = await import(
    '../../tools/assets/tornadoDiagnostic'
  );
  expect(TORNADO_DIAGNOSTIC_PINS.candidateSha256).toBe(
    'a6b4fa74fc2d43b97ce11e66ea97ea6eb5b32952baec76e63aeed1fef6ffcf35',
  );
  expect(TORNADO_DIAGNOSTIC_PINS.recipeSha256).toBe(
    'f52eb97aebb9b84553fba032a41addbb5726f2afc5bccc59edd567b35efe9426',
  );
  const entry = loadTornadoDiagnostic(diagnosticInput());
  expect(entry.asset.definition.clipId).toBe('TornadoKick');
  expect(entry.asset.definition.rootCurve).toHaveLength(632);
  expect(entry.asset.definition.impacts).toHaveLength(1);
  expect(entry.rawRootRotationCurve.at(-1)?.visualYawRad).toBe(
    6.283185482025223,
  );
  expect(
    entry.rawRootRotationCurve.some(
      (key) => key.quaternion.x !== 0 && key.quaternion.z !== 0,
    ),
  ).toBe(true);
  expect(Math.min(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    -0.18849612772464752,
  );
  expect(Math.max(...entry.rawRootCurve.map((key) => key.position.y))).toBe(
    0.7433349639177322,
  );
  expect(entry.rawRootCurve.at(-1)?.position).toEqual({
    x: 0.40000003576278687,
    y: -4.470348358154297e-8,
    z: 0.850000161677599,
  });
  expect(entry.regions[0]?.polygons).toHaveLength(183);
  expect(
    entry.regions[0]?.polygons.every(
      (polygon) => polygon.region === 'instep-hypothesis',
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
  expect(measurement.maximumFiniteSurfaceEscapeM).toBe(0.005766009329590482);
  expect(measurement.probes).toBe(229);
  expect(measurement.testedCorners).toBe(137171);
  expect(
    measurement.directionalExcess.find((row) => row.axis === '+Y')?.maximumM,
  ).toBe(0.11925706990266793);
  expect(measurement.continuousClaim).toBe(false);
  expect(entry.acceptance).toBeNull();
  expect(entry.gameplayAllowance).toBeNull();
  expect(entry.regionVisualAcceptance).toBeNull();
  expect(entry.continuousContainment).toBeNull();
  expect(entry.supportMeasurementStatus).toContain('no sole-clearance claim');
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.asset.definition.rootCurve)).toBe(true);
});
test('source-free reconstructed fixture loader rejects altered candidate or recipe bytes', async () => {
  const { loadTornadoDiagnostic } = await import(
    '../../tools/assets/tornadoDiagnostic'
  );
  for (const key of ['candidateBytes', 'recipeBytes'] as const) {
    const input = diagnosticInput();
    const original = input[key][100];
    if (original === undefined) throw new Error('Missing mutation byte');
    input[key][100] = original ^ 1;
    expect(() => loadTornadoDiagnostic(input)).toThrow(/hash/i);
  }
});
