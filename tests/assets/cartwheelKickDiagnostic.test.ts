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
    existsSync('tools/assets/cartwheelKickDiagnostic.ts'),
    'source-zero reader must exist',
  ).toBe(true);
  return import('../../tools/assets/cartwheelKickDiagnostic');
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
test('source0 does not promote the phase-derived diagnostic to an authored attack range', async () => {
  const d = (await api()).readCartwheelKickSource(input());
  expect(d.clipId).toBe('CartwheelKick');
  expect(d.sourceClipPointer).toBe('/clips/7');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'foot.L',
    peakFrame: 66,
    sourceFrames: null,
    diagnosticFrames: [59, 68],
    windowOrigin: 'developer-provisional-phase-derived',
    sourcePhasePointer: '/clips/7/phases/phases/3',
    sourceEventPointer: '/clips/7/attack_and_timeline_events/strikes/0',
    sourceEvent: { limb: 'foot.L', frame: 66, type: 'lateral exit kick' },
    acceptance: null,
  });
  expect(d.events[0]?.sourceEvent).not.toHaveProperty('window');
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d).not.toHaveProperty('shapes');
});
test('source0 retains independent native clock, initial hold and next-cell half-open end', async () => {
  const { readCartwheelKickSource, validateCartwheelKickAccessorTimes } =
    await api();
  const d = readCartwheelKickSource(input());
  expect(d.sourceTimesSeconds).toEqual(
    raw()
      .accessor(514)
      .map((row) => row[0]),
  );
  expect(d.sourceTimesSeconds).toHaveLength(91);
  expect(d.durationMs).toBe(2022.2222805023193);
  expect(d.events[0]?.window).toMatchObject({
    startMs: 1311.1110925674438,
    peakMs: 1466.6666984558105,
    endMs: 1533.3333015441895,
    initialHoldEndMs: 22.22222276031971,
    policy: 'inclusive-accessor-frame-cells-v1',
    acceptance: 'provisional-policy',
  });
  for (const changed of [
    d.sourceTimesSeconds.slice(1),
    d.sourceTimesSeconds.map((t) => t - 1 / 45),
    d.sourceTimesSeconds.map((t, i) => (i === 65 ? t + 1e-9 : t)),
    [...d.sourceTimesSeconds].reverse(),
  ])
    expect(() => validateCartwheelKickAccessorTimes(changed)).toThrow();
});
test('source0 preserves all 159 raw TRS channels including nonunit scales', async () => {
  const d = (await api()).readCartwheelKickSource(input());
  const oracle = raw();
  const a = oracle.doc.animations[7];
  expect(d.nativeChannels).toHaveLength(159);
  for (const [index, channel] of d.nativeChannels.entries()) {
    const expected = a.channels[index],
      sampler = a.samplers[expected.sampler];
    expect(channel).toMatchObject({
      nodeIndex: expected.target.node,
      nodeName: oracle.doc.nodes[expected.target.node].name,
      path: expected.target.path,
      inputAccessor: sampler.input,
      outputAccessor: sampler.output,
      interpolation: sampler.interpolation,
    });
    expect(channel.timesSeconds).toEqual(
      oracle.accessor(sampler.input).map((row) => row[0]),
    );
    expect(channel.values).toEqual(oracle.accessor(sampler.output));
  }
  const footScale = d.nativeChannels.find(
    (c) => c.nodeIndex === 44 && c.path === 'scale',
  );
  expect(footScale).toMatchObject({
    outputAccessor: 659,
    interpolation: 'STEP',
    values: [
      [1, 1.000000238418579, 1.000000238418579],
      [1.0000001192092896, 1.0000001192092896, 1.0000003576278687],
    ],
  });
});
test('source0 retains full roll and root translation rather than yaw-only endpoints', async () => {
  const d = (await api()).readCartwheelKickSource(input());
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.nativeRootRotation.quaternions).toEqual(raw().accessor(516));
  expect(d.nativeRootTranslation.positions).toEqual(raw().accessor(515));
  expect(d.nativeRootRotation.unwrappedZRollRad).toBeCloseTo(
    -6.283185482025139,
    12,
  );
  expect(d.nativeRootRotation.rollIsNotYaw).toBe(true);
  expect(d.nativeRootRotation.quaternions[38]).toEqual([
    -0, -0, -0.9914448857307434, 0.13052621483802795,
  ]);
  expect(d.nativeRootTranslation.positions[90]).toEqual([
    2.6750001907348633, -0.01999998278915882, 0,
  ]);
});
test('source0 preserves authored hand support as unverified metadata without contact or region acceptance', async () => {
  const d = (await api()).readCartwheelKickSource(input());
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expect(d.sourceSupport).toEqual(manifest.clips[7].support_contacts);
  expect(d.supportValidation).toBe('unverified-metadata-only');
  expect(d.sourcePhases).toEqual(manifest.clips[7].phases);
  expect(d.nativeNodes).toEqual(raw().doc.nodes);
  expect(Object.isFrozen(d.nativeChannels[0]?.values[0])).toBe(true);
  expect(Object.isFrozen(d.sourceSupport)).toBe(true);
});
test('source0 refuses changed bytes, changed strike side and fabricated authored window', async () => {
  const { readCartwheelKickSource, CARTWHEEL_KICK_SOURCE_PINS } = await api();
  expect(createHash('sha256').update(input().sourceBytes).digest('hex')).toBe(
    CARTWHEEL_KICK_SOURCE_PINS.sourceSha256,
  );
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const changed = input();
    changed[field] = Buffer.from(changed[field]);
    changed[field][100] = (changed[field][100] ?? 0) ^ 1;
    expect(() => readCartwheelKickSource(changed)).toThrow(/hash/);
  }
  for (const patch of [{ limb: 'foot.R' }, { window: [59, 68] }]) {
    const changed = input();
    const m = JSON.parse(changed.manifestBytes.toString());
    Object.assign(m.clips[7].attack_and_timeline_events.strikes[0], patch);
    changed.manifestBytes = Buffer.from(JSON.stringify(m));
    expect(() => readCartwheelKickSource(changed)).toThrow(/hash/);
  }
});
