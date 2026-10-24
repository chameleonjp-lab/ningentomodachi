/** Metadata only: independently decode bytes, never evaluate source poses. */
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
const api = () => import('../../tools/assets/butterflyKickDiagnostic');
function raw() {
  const b = input().sourceBytes;
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + n).toString());
  const accessor = (i: number, width: number) => {
    const a = j.accessors[i],
      v = j.bufferViews[a.bufferView];
    const start = 28 + n + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    expect(a.componentType).toBe(5126);
    const values: number[][] = Array.from({ length: a.count }, (_, k) =>
      Array.from({ length: width }, (_, c) =>
        b.readFloatLE(start + k * (v.byteStride ?? width * 4) + c * 4),
      ),
    );
    const packed = Buffer.alloc(a.count * width * 4);
    values.flat().forEach((x, k) => {
      packed.writeFloatLE(x, k * 4);
    });
    return { values, hash: createHash('sha256').update(packed).digest('hex') };
  };
  return { j, accessor };
}
test('preserves two distinct authored foot events and provisional native cells', async () => {
  const d = (await api()).readButterflyKickSource(input());
  expect(d.clipId).toBe('ButterflyKick');
  expect(d.sourceClipPointer).toBe('/clips/15');
  expect(d.sourceTimesSeconds).toHaveLength(88);
  expect(d.durationMs).toBe(1955.5555582046509);
  expect(d.events).toHaveLength(2);
  expect(d.events[0]).toMatchObject({
    impactIndex: 0,
    boneName: 'foot.L',
    side: 'L',
    node: 44,
    skinJoint: 47,
    sourceFrames: [35, 39],
    peakFrame: 37,
    intendedRegion: null,
    acceptance: null,
    window: {
      startMs: 777.7777314186096,
      endMs: 888.8888955116272,
      peakMs: 822.2222328186035,
      acceptance: 'provisional-policy',
    },
  });
  expect(d.events[1]).toMatchObject({
    impactIndex: 1,
    boneName: 'foot.R',
    side: 'R',
    node: 48,
    skinJoint: 51,
    sourceFrames: [41, 47],
    peakFrame: 43,
    intendedRegion: null,
    acceptance: null,
    window: {
      startMs: 911.1111164093018,
      endMs: 1066.6667222976685,
      peakMs: 955.5554986000061,
      acceptance: 'provisional-policy',
    },
  });
  const m = JSON.parse(input().manifestBytes.toString()).clips[15];
  expect(d.events.map((e) => e.sourceEvent)).toEqual(
    m.attack_and_timeline_events.strikes,
  );
  expect(d.sourceSupport).toEqual(m.support_contacts);
  expect(d.sourcePhases).toEqual(m.phases);
  expect(d.supportVerification).toMatchObject({
    status: 'source-claim-unverified',
    validationDocumentAvailable: false,
  });
  expect(d.regionChoice).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(Object.isFrozen(d.events[0]?.sourceEvent)).toBe(true);
});
test('pins raw root quaternion path, both leg chains and microscopic transforms independently', async () => {
  const d = (await api()).readButterflyKickSource(input());
  const { j, accessor } = raw();
  const a = j.animations[15];
  expect(a.name).toBe('ButterflyKick');
  expect(a.channels).toHaveLength(159);
  for (const pin of d.transformChannels) {
    const c = a.channels.find(
      (c: { target: { node: number; path: string } }) =>
        c.target.node === pin.node && c.target.path === pin.path,
    );
    expect(a.samplers[c.sampler]).toEqual({
      input: pin.input,
      output: pin.output,
      interpolation: pin.interpolation,
    });
    const actual = accessor(pin.output, pin.path === 'rotation' ? 4 : 3);
    expect(actual.hash).toBe(pin.sha256);
    expect(actual.values).toEqual(pin.values);
  }
  expect(accessor(353, 1).values.flat()).toEqual(d.sourceTimesSeconds);
  expect(accessor(353, 1).hash).toBe(d.timeProvenance.nativeTimesSha256);
  expect(accessor(354, 3).values[0]).toEqual([
    0, -0.06432700902223587, -0.03856395184993744,
  ]);
  expect(accessor(354, 3).values.at(-1)).toEqual([
    0.9800001978874207, -0.06432700902223587, 0.24143609404563904,
  ]);
  expect(accessor(359, 4).values.at(-1)).not.toEqual([0, 0, 0, 1]);
  expect(
    d.transformChannels
      .filter((p) => p.path === 'scale' && p.node !== 51 && p.node !== 52)
      .every((p) => p.values.flat().some((x) => x !== 1)),
  ).toBe(true);
  expect(j.nodes[54]).toMatchObject({
    children: [53, 52],
    translation: [0, -0.02199999988079071, 0],
  });
  for (const chain of [
    [51, 46, 45, 44, 43],
    [51, 50, 49, 48, 47],
  ])
    for (let i = 1; i < chain.length; i++)
      expect(j.nodes[chain[i - 1]!].children).toContain(chain[i]);
  expect(j.skins[0].joints[47]).toBe(44);
  expect(j.skins[0].joints[51]).toBe(48);
  let previous = 0;
  const yaw = accessor(355, 4).values.map((q) => {
    const [x = 0, y = 0, z = 0, w = 0] = q;
    let v = Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
    while (v - previous > Math.PI) v -= 2 * Math.PI;
    while (v - previous < -Math.PI) v += 2 * Math.PI;
    previous = v;
    return v;
  });
  expect(yaw.at(-1)).toBeCloseTo(-6.2831854819186574, 12);
  expect(yaw[42]!).toBeGreaterThan(yaw[38]!);
  expect(d.rootTransformRequirement).toMatchObject({
    preserveAllAnimationChannels: true,
    endReset: false,
    applyOrExtractExactlyOnce: true,
    yawProjectionIsAuthoredHeading: false,
    acceptance: null,
  });
});
test('fails closed on source or annotation changes and retimed clocks', async () => {
  const { readButterflyKickSource, validateButterflyKickAccessorTimes } =
    await api();
  const t = readButterflyKickSource(input()).sourceTimesSeconds;
  for (const changed of [
    t.slice(1),
    t.map((x) => x / 1.5),
    t.map((x, i) => (i === 35 ? NaN : x)),
    t.map((x, i) => (i === 35 ? Math.fround(x + 0.001) : x)),
  ])
    expect(() => validateButterflyKickAccessorTimes(changed)).toThrow();
  const changed = input();
  changed.sourceBytes[100] = (changed.sourceBytes[100] ?? 0) ^ 1;
  expect(() => readButterflyKickSource(changed)).toThrow(/hash/);
  const m = JSON.parse(input().manifestBytes.toString());
  m.clips[15].attack_and_timeline_events.strikes[0].limb = 'foot.R';
  expect(() =>
    readButterflyKickSource({
      ...input(),
      manifestBytes: Buffer.from(JSON.stringify(m)),
    }),
  ).toThrow(/hash/);
});
