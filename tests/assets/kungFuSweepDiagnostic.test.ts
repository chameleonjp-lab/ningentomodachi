/** Raw bytes only: no loader, poses, evaluator or geometry selection. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const api = () => import('../../tools/assets/kungFuSweepDiagnostic');
function required<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('Missing raw value');
  return x;
}
function rawSource() {
  const bytes = input().sourceBytes;
  const n = bytes.readUInt32LE(12);
  const raw = JSON.parse(bytes.subarray(20, 20 + n).toString());
  const anim = raw.animations[11];
  const channel = (node: number, path: string) => {
    const c = anim.channels.find(
      (c: { target: { node: number; path: string } }) =>
        c.target.node === node && c.target.path === path,
    );
    return anim.samplers[c.sampler];
  };
  const accessor = (index: number, components: number) => {
    const a = raw.accessors[index],
      bv = raw.bufferViews[a.bufferView];
    expect(a.componentType).toBe(5126);
    const start = 28 + n + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const values = Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: components }, (_, k) =>
        bytes.readFloatLE(
          start + i * (bv.byteStride ?? components * 4) + k * 4,
        ),
      ),
    );
    const packed = Buffer.alloc(values.length * components * 4);
    values.flat().forEach((x, i) => {
      packed.writeFloatLE(x, i * 4);
    });
    return { values, hash: createHash('sha256').update(packed).digest('hex') };
  };
  return { raw, anim, channel, accessor };
}
test('preserves authored sweep event without inventing foot or shin admission', async () => {
  const d = (await api()).readKungFuSweepSource(input());
  expect(d.clipId).toBe('KungFuSweep');
  expect(d.sourceClipPointer).toBe('/clips/11');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    sourceFrames: [26, 44],
    peakFrame: 35,
    boneName: null,
    side: 'R',
    sourceEvent: { type: 'right low sweeping leg', impact_frame: 35 },
    intendedRegion: null,
    acceptance: null,
  });
  expect(d.regionChoice).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d.speedProvenance).toEqual({
    sourceFps: 45,
    originalSourceFps: 30,
    bakedSpeedMultiplier: 1.5,
    runtimePlaybackSpeed: 1,
  });
});
test('uses raw native time cells rather than ideal zero based clock or prose duration', async () => {
  const d = (await api()).readKungFuSweepSource(input());
  const { anim, accessor } = rawSource();
  expect(anim.name).toBe('KungFuSweep');
  expect(anim.channels).toHaveLength(159);
  const t = accessor(2122, 1);
  expect(t.values).toHaveLength(78);
  expect(t.values.map((x) => x[0])).toEqual(d.sourceTimesSeconds);
  expect(t.hash).toBe(d.timeProvenance.nativeTimesSha256);
  expect(d.durationMs).toBe(1733.3332300186157);
  expect(d.manifestDurationSeconds).toBe(1.7111111111111112);
  expect(d.events[0]?.window).toMatchObject({
    startMs: 577.7778029441833,
    endMs: 1000,
    peakMs: 777.7777314186096,
    initialHoldEndMs: 22.22222276031971,
    acceptance: 'provisional-policy',
  });
  const w = required(d.events[0]).window;
  expect(w.startMs).toBe(required(required(t.values[25])[0]) * 1000);
  expect(w.endMs).toBe(required(required(t.values[44])[0]) * 1000);
  expect(w.peakMs).toBe(required(required(t.values[34])[0]) * 1000);
});
test('binds raw root channels and retains full travel and continuous final heading', async () => {
  const d = (await api()).readKungFuSweepSource(input());
  const { raw, channel, accessor } = rawSource();
  for (const [node, path, input, output, interpolation] of [
    [52, 'translation', 2122, 4044, 'LINEAR'],
    [52, 'rotation', 2122, 4045, 'LINEAR'],
    [52, 'scale', 2124, 4046, 'STEP'],
    [51, 'translation', 2124, 4047, 'LINEAR'],
    [51, 'rotation', 2124, 4048, 'STEP'],
  ] as const)
    expect(channel(node, path)).toEqual({ input, output, interpolation });
  const r = accessor(4044, 3),
    q = accessor(4045, 4);
  expect(r.hash).toBe(d.rootTransformRequirement.translationAccessorSha256);
  expect(q.hash).toBe(d.rootTransformRequirement.quaternionAccessorSha256);
  expect(r.values[0]).toEqual([0, -0.07500001043081284, 0]);
  expect(r.values.at(-1)).toEqual([
    0.4058678448200226, -0.07500001788139343, 0.08779317140579224,
  ]);
  const yaw = q.values.map(
    (v) => 2 * Math.atan2(required(v[1]), required(v[3])),
  );
  expect(yaw.at(-1)).toBeCloseTo(2.4, 6);
  expect(Math.min(...yaw)).toBeCloseTo(-0.46, 6);
  expect(
    yaw.slice(1).every((v, i) => Math.abs(v - required(yaw[i])) < Math.PI),
  ).toBe(true);
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.rootTransformRequirement).toMatchObject({
    translationAccessor: 4044,
    quaternionAccessor: 4045,
    pelvisTranslationAccessor: 4047,
    pelvisQuaternionAccessor: 4048,
    translationAxes: ['x', 'y', 'z'],
    rootRotationInterpolation: 'LINEAR',
    endReset: false,
    preserveAllAnimationChannels: true,
    applyOrExtractExactlyOnce: true,
    sourceFinalHeadingRadians: 2.4,
    acceptance: null,
  });
  expect(raw.nodes[54]).toMatchObject({
    children: [53, 52],
    translation: d.rootTransformRequirement.parentTranslation,
  });
  expect(raw.nodes[52].children).toEqual([51]);
  expect(raw.nodes[51].children).toContain(50);
});
test('fails closed on changed source bytes and event or root annotations', async () => {
  const { readKungFuSweepSource } = await api();
  const changed = input();
  changed.sourceBytes[100] = (changed.sourceBytes[100] ?? 0) ^ 1;
  expect(() => readKungFuSweepSource(changed)).toThrow(/hash/);
  for (const key of [
    'attack_and_timeline_events',
    'root_motion',
    'support_contacts',
  ]) {
    const original = input();
    const m = JSON.parse(original.manifestBytes.toString());
    m.clips[11][key] = null;
    expect(() =>
      readKungFuSweepSource({
        ...original,
        manifestBytes: Buffer.from(JSON.stringify(m)),
      }),
    ).toThrow(/hash/);
  }
});
test('rejects shortened retimed shifted and nonnative clocks', async () => {
  const { readKungFuSweepSource, validateKungFuSweepAccessorTimes } =
    await api();
  const t = readKungFuSweepSource(input()).sourceTimesSeconds;
  expect(() => validateKungFuSweepAccessorTimes(t)).not.toThrow();
  for (const changed of [
    t.slice(1),
    t.map((x) => x / 1.5),
    t.map((x) => x - required(t[0])),
    t.map((x, i) => (i === 25 ? NaN : x)),
    t.map((x, i) => (i === 25 ? Math.fround(x + 0.001) : x)),
  ])
    expect(() => validateKungFuSweepAccessorTimes(changed)).toThrow();
});
test('returns frozen unresolved provenance rather than gameplay approval', async () => {
  const d = (await api()).readKungFuSweepSource(input());
  expect(Object.isFrozen(d)).toBe(true);
  expect(Object.isFrozen(d.events[0]?.sourceEvent)).toBe(true);
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
  expect(d.sourceStartEndUse).toContain('never reset root rotation');
});
