/** Raw metadata only. No evaluator, GLTF loader, pose, or surface selection. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('../../src/assets/evaluateSource', () => ({
  createSourceEvaluator: () => {
    throw new Error('Source poses forbidden');
  },
}));
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test value');
  return value;
}
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
const api = () => import('../../tools/assets/aerialKneeDiagnostic');
test('pins one authored knee event and exact 66 native keys without surface admission', async () => {
  const { readAerialKneeSource } = await api();
  const d = readAerialKneeSource(input());
  expect(d.clipId).toBe('AerialKnee');
  expect(d.sourceClipPointer).toBe('/clips/6');
  expect(d.sourceTimesSeconds).toHaveLength(66);
  expect(d.durationMs).toBe(1466.6666984558105);
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'shin.R',
    side: 'R',
    sourceFrames: [26, 31],
    peakFrame: 29,
    sourceEventPointer: '/clips/6/attack_and_timeline_events/attack_events/0',
    sourceEvent: {
      limb: 'shin.R head / right knee',
      type: 'upward/forward knee',
      foot_is_not_strike_surface: true,
    },
    intendedRegion: null,
    acceptance: null,
    window: {
      startMs: 577.7778029441833,
      endMs: 711.1111283302307,
      peakMs: 644.4444060325623,
      acceptance: 'provisional-policy',
    },
  });
  expect(d.regionChoice).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.rootTransformRequirement).toMatchObject({
    rootNode: 52,
    pelvisNode: 51,
    parentNode: 54,
    translationAccessor: 193,
    quaternionAccessor: 195,
    pelvisTranslationAccessor: 197,
    pelvisQuaternionAccessor: 198,
    shinNode: 49,
    shinSkinJoint: 50,
    shinTranslationAccessor: 344,
    shinQuaternionAccessor: 345,
    translationAxes: ['x', 'y', 'z'],
    parentTranslation: [0, -0.02199999988079071, 0],
    preserveAllAnimationChannels: true,
    endReset: false,
    acceptance: null,
  });
  expect(Object.isFrozen(d.events[0]?.sourceEvent)).toBe(true);
});
test('independently verifies raw channel, accessor and hierarchy pins', async () => {
  const { readAerialKneeSource } = await api();
  const bytes = input().sourceBytes;
  const d = readAerialKneeSource(input());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(12, true);
  const raw = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + n)));
  const anim = raw.animations[6];
  expect(anim.name).toBe('AerialKnee');
  expect(anim.channels).toHaveLength(159);
  const channel = (node: number, path: string) => {
    const c = anim.channels.find(
      (c: { target: { node: number; path: string } }) =>
        c.target.node === node && c.target.path === path,
    );
    return anim.samplers[c.sampler];
  };
  for (const [node, path, input, output, interpolation] of [
    [52, 'translation', 192, 193, 'LINEAR'],
    [52, 'rotation', 194, 195, 'STEP'],
    [51, 'translation', 194, 197, 'STEP'],
    [51, 'rotation', 194, 198, 'STEP'],
    [49, 'translation', 194, 344, 'LINEAR'],
    [49, 'rotation', 192, 345, 'LINEAR'],
  ] as const)
    expect(channel(node, path)).toEqual({ input, output, interpolation });
  const accessor = (index: number, components: number) => {
    const a = raw.accessors[index],
      bv = raw.bufferViews[a.bufferView];
    expect(a.componentType).toBe(5126);
    const start = 28 + n + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const values: number[][] = Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: components }, (_, j) =>
        view.getFloat32(
          start + i * (bv.byteStride ?? components * 4) + j * 4,
          true,
        ),
      ),
    );
    const packed = Buffer.alloc(values.length * components * 4);
    values.flat().forEach((x, i) => {
      packed.writeFloatLE(x, i * 4);
    });
    return { values, hash: createHash('sha256').update(packed).digest('hex') };
  };
  const times = accessor(192, 1);
  expect(times.values.map((x) => x[0])).toEqual(d.sourceTimesSeconds);
  expect(times.hash).toBe(d.timeProvenance.nativeTimesSha256);
  const root = accessor(193, 3);
  expect(root.hash).toBe(d.rootTransformRequirement.translationAccessorSha256);
  expect(root.values[0]).toEqual([0, -0.059999655932188034, 0]);
  expect(root.values.at(-1)).toEqual([
    0, -0.0599997341632843, 0.9000002145767212,
  ]);
  expect(Math.min(...root.values.map((x) => required(x[1])))).toBe(
    -0.32000014185905457,
  );
  expect(Math.max(...root.values.map((x) => required(x[1])))).toBe(
    0.5288848280906677,
  );
  expect(accessor(195, 4).values).toEqual([
    [0, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  expect(accessor(345, 4).hash).toBe(
    d.rootTransformRequirement.shinQuaternionAccessorSha256,
  );
  expect(raw.nodes[54]).toMatchObject({
    children: [53, 52],
    translation: [0, -0.02199999988079071, 0],
  });
  expect(raw.nodes[52].children).toEqual([51]);
  expect(raw.nodes[51].children).toContain(50);
  expect(raw.nodes[50].children).toContain(49);
  expect(raw.skins[0].joints[50]).toBe(49);
});
test('rejects changed source bytes, authored event, root policy and hierarchy before interpretation', async () => {
  const { readAerialKneeSource } = await api();
  const altered = input();
  altered.sourceBytes[100] = (altered.sourceBytes[100] ?? 0) ^ 1;
  expect(() => readAerialKneeSource(altered)).toThrow(/hash/);
  for (const mutate of [
    (m: {
      clips: {
        attack_and_timeline_events: {
          attack_events: {
            foot_is_not_strike_surface: boolean;
            frames: number[];
          }[];
        };
        root_motion: { root_motion: { end_reset: boolean } };
      }[];
    }) => {
      required(
        required(m.clips[6]).attack_and_timeline_events.attack_events[0],
      ).foot_is_not_strike_surface = false;
    },
    (m: {
      clips: {
        attack_and_timeline_events: {
          attack_events: {
            foot_is_not_strike_surface: boolean;
            frames: number[];
          }[];
        };
        root_motion: { root_motion: { end_reset: boolean } };
      }[];
    }) => {
      required(
        required(m.clips[6]).attack_and_timeline_events.attack_events[0],
      ).frames = [25, 31];
    },
    (m: {
      clips: {
        attack_and_timeline_events: {
          attack_events: {
            foot_is_not_strike_surface: boolean;
            frames: number[];
          }[];
        };
        root_motion: { root_motion: { end_reset: boolean } };
      }[];
    }) => {
      required(m.clips[6]).root_motion.root_motion.end_reset = true;
    },
  ]) {
    const original = input();
    const manifest = JSON.parse(original.manifestBytes.toString());
    mutate(manifest);
    expect(() =>
      readAerialKneeSource({
        ...original,
        manifestBytes: Buffer.from(JSON.stringify(manifest)),
      }),
    ).toThrow(/hash/);
  }
  const hierarchy = input();
  const n = hierarchy.sourceBytes.readUInt32LE(12);
  const json = hierarchy.sourceBytes.subarray(20, 20 + n).toString();
  const changed = json.replace('"children":[53,52]', '"children":[53,51]');
  expect(changed).not.toBe(json);
  hierarchy.sourceBytes.write(changed, 20);
  expect(() => readAerialKneeSource(hierarchy)).toThrow(/hash/);
});
test('rejects retimed, shortened, nonfinite or nonnative clocks', async () => {
  const { readAerialKneeSource, validateAerialKneeAccessorTimes } = await api();
  const t = readAerialKneeSource(input()).sourceTimesSeconds;
  expect(() => validateAerialKneeAccessorTimes(t)).not.toThrow();
  for (const changed of [
    t.slice(1),
    t.map((x) => x / 1.5),
    t.map((x, i) => (i === 25 ? NaN : x)),
    t.map((x, i) => (i === 25 ? x + 0.000001 : x)),
    t.map((x, i) => (i === 25 ? Math.fround(x + 0.001) : x)),
  ])
    expect(() => validateAerialKneeAccessorTimes(changed)).toThrow();
});
