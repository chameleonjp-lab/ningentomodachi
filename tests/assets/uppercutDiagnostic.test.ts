/** Metadata only; original source poses are forbidden in this suite. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('../../src/assets/evaluateSource', () => ({
  createSourceEvaluator: () => {
    throw new Error('Source execution forbidden');
  },
}));
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const api = () => import('../../tools/assets/uppercutDiagnostic');
test('pins Uppercut identity, native clock and one explicit provisional event without posing', async () => {
  const { readUppercutSource } = await api();
  const d = readUppercutSource(input());
  expect(d.clipId).toBe('Uppercut');
  expect(d.sourceClipPointer).toBe('/clips/3');
  expect(d.sourceTimesSeconds).toHaveLength(47);
  expect(d.durationMs).toBe(1044.4444417953491);
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'hand.R',
    sourceFrames: [21, 24],
    peakFrame: 23,
    intendedRegion: null,
    acceptance: null,
    window: {
      startMs: 466.66666865348816,
      endMs: 555.555522441864,
      peakMs: 511.1110806465149,
      acceptance: 'provisional-policy',
    },
  });
  expect(d.timeProvenance.fullTimeAccessorPointer).toBe('/accessors/6286');
  expect(d.rootTransformRequirement).toMatchObject({
    rootNode: 52,
    pelvisNode: 51,
    translationAccessor: 6287,
    quaternionAccessor: 6289,
    pelvisQuaternionAccessor: 6292,
    preserveAllAnimationChannels: true,
  });
  // Independent binary metadata/accessor parsing, never a GLTF loader or pose.
  const bytes = input().sourceBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const raw = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  );
  const animation = raw.animations[3];
  expect(animation.name).toBe('Uppercut');
  expect(animation.channels).toHaveLength(159);
  const channel = (node: number, path: string) => {
    const c = animation.channels.find(
      (x: { target: { node: number; path: string } }) =>
        x.target.node === node && x.target.path === path,
    );
    if (!c) throw new Error('Missing pinned raw channel');
    return animation.samplers[c.sampler];
  };
  expect(channel(52, 'translation')).toEqual({
    input: 6286,
    interpolation: 'LINEAR',
    output: 6287,
  });
  expect(channel(52, 'rotation')).toEqual({
    input: 6288,
    interpolation: 'STEP',
    output: 6289,
  });
  expect(channel(51, 'rotation')).toEqual({
    input: 6286,
    interpolation: 'LINEAR',
    output: 6292,
  });
  const readFloatAccessor = (index: number, components: number) => {
    const a = raw.accessors[index],
      bufferView = raw.bufferViews[a.bufferView];
    expect(a.componentType).toBe(5126);
    const stride = bufferView.byteStride ?? components * 4;
    const start =
      28 + jsonLength + (bufferView.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const values: number[][] = Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: components }, (_, c) =>
        view.getFloat32(start + i * stride + c * 4, true),
      ),
    );
    const packed = new Uint8Array(a.count * components * 4),
      packedView = new DataView(packed.buffer);
    values.flat().forEach((x, i) => {
      packedView.setFloat32(i * 4, x, true);
    });
    return { values, hash: createHash('sha256').update(packed).digest('hex') };
  };
  const times = readFloatAccessor(6286, 1);
  expect(times.values.map((x) => x[0])).toEqual(d.sourceTimesSeconds);
  expect(times.hash).toBe(d.timeProvenance.nativeTimesSha256);
  expect(readFloatAccessor(6288, 1).hash).toBe(
    'd5e2a68d166086f4d8539cb76be9b481da8595149e196793963720a73a6bb60b',
  );
  expect(readFloatAccessor(6287, 3).hash).toBe(
    d.rootTransformRequirement.translationAccessorSha256,
  );
  const root = readFloatAccessor(6289, 4);
  expect(root.hash).toBe(d.rootTransformRequirement.quaternionAccessorSha256);
  expect(root.values).toEqual([
    [0, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  const pelvis = readFloatAccessor(6292, 4);
  expect(pelvis.hash).toBe(
    d.rootTransformRequirement.pelvisQuaternionAccessorSha256,
  );
  expect(pelvis.values[0]).not.toEqual([0, 0, 0, 1]);
  expect(raw.nodes[54].children).toContain(52);
  expect(raw.nodes[54].translation).toEqual(
    d.rootTransformRequirement.parentTranslation,
  );
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(Object.isFrozen(d)).toBe(true);
});
test('rejects changed source or manifest bytes', async () => {
  const { readUppercutSource } = await api();
  for (const key of ['sourceBytes', 'manifestBytes'] as const) {
    const x = input();
    const original = x[key][100];
    if (original === undefined) throw new Error('Missing test mutation byte');
    x[key][100] = original ^ 1;
    expect(() => readUppercutSource(x)).toThrow(/hash/);
  }
});
test('native clock rejects reordering, retiming, missing keys and nonfinite values', async () => {
  const { readUppercutSource, validateUppercutAccessorTimes } = await api();
  const t = [...readUppercutSource(input()).sourceTimesSeconds];
  for (const changed of [
    t.slice(1),
    [...t].reverse(),
    t.map((x) => x * 1.5),
    t.map((x, i) => (i === 3 ? NaN : x)),
    t.map((x, i) => (i === 3 ? x + 1e-9 : x)),
  ])
    expect(() => validateUppercutAccessorTimes(changed)).toThrow();
  expect(() => validateUppercutAccessorTimes(t)).not.toThrow();
});
