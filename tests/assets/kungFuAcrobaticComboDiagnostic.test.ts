/** SourcePOSE0 regressions: fabricated authored range, clock shift, yaw-only root,
 * channel/scale loss, contact overclaim and changed original bytes. */
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
    existsSync('tools/assets/kungFuAcrobaticComboDiagnostic.ts'),
    'source-zero reader must exist',
  ).toBe(true);
  return import('../../tools/assets/kungFuAcrobaticComboDiagnostic');
}
/** Independent byte-level oracle, no production parser, loader or posing. */
function raw() {
  const bytes = readFileSync(sourcePath);
  const length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const accessor = (index: number) => {
    const a = doc.accessors[index],
      v = doc.bufferViews[a.bufferView];
    const width = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 4;
    const offset = 28 + length + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({ length: a.count }, (_, row) =>
      Array.from({ length: width }, (_, col) =>
        bytes.readFloatLE(offset + row * (v.byteStride ?? width * 4) + col * 4),
      ),
    );
  };
  return { doc, accessor };
}
test('keeps three right-foot peaks separate from provisional phase windows', async () => {
  const d = (await api()).readKungFuAcrobaticComboSource(input());
  expect(d.clipId).toBe('KungFuAcrobaticCombo');
  expect(d.events).toHaveLength(3);
  expect(new Set(d.events.map((e) => e.impactId)).size).toBe(3);
  const peaks = [40, 94, 140],
    frames = [
      [27, 53],
      [79, 106],
      [135, 153],
    ],
    phases = [2, 4, 6];
  d.events.forEach((e, i) => {
    expect(e).toMatchObject({
      impactIndex: i,
      boneName: 'foot.R',
      peakFrame: peaks[i],
      sourceFrames: null,
      diagnosticFrames: frames[i],
      windowOrigin: 'developer-provisional-phase-derived',
      acceptance: null,
      sourceEventPointer: `/clips/18/attack_and_timeline_events/attacks/${i}`,
      sourcePhasePointer: `/clips/18/phases/phases/${phases[i]}`,
    });
    expect(e.sourceEvent).not.toHaveProperty('window');
  });
  expect(d.sourcePhases.airborne_intervals).toEqual([
    [27, 53],
    [79, 105],
    [117, 153],
  ]);
  expect(d.events[1]?.diagnosticFrames[1]).toBe(106);
  expect(d.acceptance).toBeNull();
  expect(d.model).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d).not.toHaveProperty('shapes');
  expect(d.geometryPolicy).toBe(
    'unresolved-no-helper-or-whole-foot-assumption',
  );
});
test('keeps native float32 clock and initial hold, not manifest-relative seconds', async () => {
  const {
    readKungFuAcrobaticComboSource,
    validateKungFuAcrobaticComboAccessorTimes,
  } = await api();
  const d = readKungFuAcrobaticComboSource(input()),
    times = raw()
      .accessor(3402)
      .map((r) => r[0]);
  expect(d.sourceTimesSeconds).toEqual(times);
  expect(times).toHaveLength(208);
  expect(d.durationMs).toBe(4622.222423553467);
  d.events.forEach((e) => {
    expect(e.window).toMatchObject({
      startMs: times[e.diagnosticFrames[0] - 1]! * 1000,
      peakMs: times[e.peakFrame - 1]! * 1000,
      endMs: times[e.diagnosticFrames[1]]! * 1000,
      initialHoldEndMs: times[0]! * 1000,
      acceptance: 'provisional-policy',
    });
  });
  for (const changed of [
    times.slice(1),
    times.map((t) => t! - 1 / 45),
    times.map((t, i) => (i === 39 ? t! + 1e-9 : t!)),
    [...times].reverse(),
  ])
    expect(() =>
      validateKungFuAcrobaticComboAccessorTimes(changed as number[]),
    ).toThrow();
});
test('retains every native TRS channel, interpolation and nonunit scale', async () => {
  const d = (await api()).readKungFuAcrobaticComboSource(input()),
    o = raw(),
    a = o.doc.animations[18];
  expect(d.nativeChannels).toHaveLength(159);
  d.nativeChannels.forEach((c, i) => {
    const e = a.channels[i],
      s = a.samplers[e.sampler];
    expect(c).toMatchObject({
      nodeIndex: e.target.node,
      path: e.target.path,
      interpolation: s.interpolation,
      inputAccessor: s.input,
      outputAccessor: s.output,
    });
    expect(c.values).toEqual(o.accessor(s.output));
    expect(c.timesSeconds).toEqual(o.accessor(s.input).map((r) => r[0]));
  });
  expect(
    d.nativeChannels.find((c) => c.nodeIndex === 49 && c.path === 'scale'),
  ).toMatchObject({
    outputAccessor: 3556,
    interpolation: 'LINEAR',
    values: [
      [1, 1.000000238418579, 0.9999997019767761],
      [1, 1.000000238418579, 0.9999998807907104],
    ],
  });
});
test('preserves all 208 full quaternions and XYZ, not a 720 degree yaw reconstruction', async () => {
  const d = (await api()).readKungFuAcrobaticComboSource(input());
  expect(d.nativeRootRotation.quaternions).toEqual(raw().accessor(3404));
  expect(d.nativeRootRotation.quaternions).toHaveLength(208);
  expect(d.nativeRootRotation.quaternions[134]).toEqual([
    0.1323421448469162, -0.8174075484275818, 0.5207460522651672,
    0.20773553848266602,
  ]);
  expect(d.nativeRootRotation.fullQuaternionRequired).toBe(true);
  expect(d.nativeRootTranslation.positions).toEqual(raw().accessor(3403));
  expect(d.rootPolicy.mode).toBe('full-translation');
});
test('does not promote support prose or infer helpers from foot.R', async () => {
  const d = (await api()).readKungFuAcrobaticComboSource(input()),
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expect(d.sourceSupport).toEqual(m.clips[18].support_contacts);
  expect(d.supportValidation).toBe('unverified-metadata-only');
  expect(d.nativeNodes).toEqual(raw().doc.nodes);
  expect(Object.isFrozen(d.nativeChannels[0]?.values[0])).toBe(true);
  expect(Object.isFrozen(d.events)).toBe(true);
});
test('rejects changed source, wrong side and fabricated source window', async () => {
  const {
    readKungFuAcrobaticComboSource,
    KUNG_FU_ACROBATIC_COMBO_SOURCE_PINS: pins,
  } = await api();
  expect(createHash('sha256').update(input().sourceBytes).digest('hex')).toBe(
    pins.sourceSha256,
  );
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const c = input();
    c[field] = Buffer.from(c[field]);
    c[field][100] = (c[field][100] ?? 0) ^ 1;
    expect(() => readKungFuAcrobaticComboSource(c)).toThrow(/hash/);
  }
  for (const patch of [{ limb: 'foot.L' }, { window: [27, 53] }]) {
    const c = input(),
      m = JSON.parse(c.manifestBytes.toString());
    Object.assign(m.clips[18].attack_and_timeline_events.attacks[0], patch);
    c.manifestBytes = Buffer.from(JSON.stringify(m));
    expect(() => readKungFuAcrobaticComboSource(c)).toThrow(/hash/);
  }
});
test('keeps the original shared tolerance unchanged while hash-pinned native cells remain exact', async () => {
  const { inclusiveAccessorFrameWindow } = await import(
    '../../tools/assets/annotationPolicy'
  );
  const {
    readKungFuAcrobaticComboSource,
    validateKungFuAcrobaticComboAccessorTimes,
  } = await api();
  const d = readKungFuAcrobaticComboSource(input()),
    times = d.sourceTimesSeconds;
  expect(Math.abs(times[186]! - (times[0]! + 186 / 45))).toBe(
    3.0783315541071943e-7,
  );
  expect(() =>
    inclusiveAccessorFrameWindow({
      sourceStartFrame: 1,
      sourceEndFrame: 208,
      fps: 45,
      firstFrame: 27,
      lastFrame: 53,
      peakFrame: 40,
      accessorTimesSeconds: times,
      durationMs: d.durationMs,
    }),
  ).toThrow('Unproven integer-frame/accessor correspondence');
  const changed = [...times];
  changed[39] = Math.fround(changed[39]! + 1e-6);
  expect(() => validateKungFuAcrobaticComboAccessorTimes(changed)).toThrow(
    'Native accessor hash mismatch',
  );
  expect(d.events[0]?.window.endMs).toBe(times[53]! * 1000);
});
