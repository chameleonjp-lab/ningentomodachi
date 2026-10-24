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
const api = () => import('../../tools/assets/chineseAerialKneeDiagnostic');
test('pins one authored knee event and exact 84 native keys without surface admission', async () => {
  const { readChineseAerialKneeSource } = await api();
  const d = readChineseAerialKneeSource(input());
  expect(d.clipId).toBe('ChineseAerialKnee');
  expect(d.sourceClipPointer).toBe('/clips/17');
  expect(d.sourceTimesSeconds).toHaveLength(84);
  expect(d.durationMs).toBe(1866.6666746139526);
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    boneName: 'shin.R',
    side: 'R',
    sourceFrames: [34, 39],
    peakFrame: 37,
    sourceEventPointer: '/clips/17/attack_and_timeline_events/attack_events/0',
    sourceEvent: {
      limb: 'right knee / shin.R head',
      type: 'forward/upward knee',
      foot_is_not_strike_surface: true,
    },
    intendedRegion: null,
    acceptance: null,
    window: {
      startMs: 755.5555701255798,
      endMs: 888.8888955116272,
      peakMs: 822.2222328186035,
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
    translationAccessor: 676,
    quaternionAccessor: 677,
    pelvisTranslationAccessor: 680,
    pelvisQuaternionAccessor: 681,
    shinNode: 49,
    shinSkinJoint: 50,
    shinTranslationAccessor: 827,
    shinQuaternionAccessor: 828,
    translationAxes: ['x', 'y', 'z'],
    parentTranslation: [0, -0.02199999988079071, 0],
    preserveAllAnimationChannels: true,
    endReset: false,
    acceptance: null,
  });
  expect(Object.isFrozen(d.events[0]?.sourceEvent)).toBe(true);
});
test('independently verifies raw channel, accessor and hierarchy pins', async () => {
  const { readChineseAerialKneeSource } = await api();
  const bytes = input().sourceBytes;
  const d = readChineseAerialKneeSource(input());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(12, true);
  const raw = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + n)));
  const anim = raw.animations[17];
  expect(anim.name).toBe('ChineseAerialKnee');
  expect(anim.channels).toHaveLength(159);
  const channel = (node: number, path: string) => {
    const c = anim.channels.find(
      (c: { target: { node: number; path: string } }) =>
        c.target.node === node && c.target.path === path,
    );
    if (!c) throw new Error('Missing raw channel');
    return anim.samplers[c.sampler];
  };
  for (const [node, path, input, output, interpolation] of [
    [52, 'translation', 675, 676, 'LINEAR'],
    [52, 'rotation', 675, 677, 'LINEAR'],
    [51, 'translation', 678, 680, 'LINEAR'],
    [51, 'rotation', 678, 681, 'STEP'],
    [49, 'translation', 678, 827, 'LINEAR'],
    [49, 'rotation', 675, 828, 'LINEAR'],
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
  const times = accessor(675, 1);
  expect(times.values.map((x) => x[0])).toEqual(d.sourceTimesSeconds);
  expect(times.hash).toBe(d.timeProvenance.nativeTimesSha256);
  const root = accessor(676, 3);
  expect(root.hash).toBe(d.rootTransformRequirement.translationAccessorSha256);
  expect(root.values[0]).toEqual([0, -0.059999655932188034, 0]);
  expect(root.values.at(-1)).toEqual([
    0.320000022649765, -0.05999946594238281, 1.2000004053115845,
  ]);
  expect(Math.min(...root.values.map((x) => required(x[1])))).toBe(
    -0.30000001192092896,
  );
  expect(Math.max(...root.values.map((x) => required(x[1])))).toBe(
    0.5700000524520874,
  );
  const rotations = accessor(677, 4);
  expect(rotations.hash).toBe(
    d.rootTransformRequirement.quaternionAccessorSha256,
  );
  const yaws = rotations.values.map(
    (q) => 2 * Math.atan2(required(q[1]), required(q[3])),
  );
  expect(Math.min(...yaws)).toBe(-0.07999999413967027);
  expect(Math.max(...yaws)).toBe(0.8800005469296825);
  expect(yaws.at(-1)).toBe(0.7853982286313229);
  expect(accessor(681, 4).values).toEqual([
    [0, 0, 0, 1],
    [0, 0, 0, 1],
  ]);
  for (const scale of d.rootTransformRequirement.scaleChain) {
    expect(channel(scale.node, 'scale')).toEqual({
      input: 678,
      output: scale.accessor,
      interpolation: scale.interpolation,
    });
    expect(accessor(scale.accessor, 3).hash).toBe(scale.sha256);
    expect(accessor(scale.accessor, 3).values).toEqual(scale.endpoints);
  }
  expect(accessor(30, 16).hash).toBe(d.geometryReference.inverseBindSha256);
  expect(raw.meshes[0].primitives[0].attributes).toMatchObject({
    POSITION: 0,
    JOINTS_0: 3,
    WEIGHTS_0: 4,
  });
  const rawAccessor = (
    index: number,
    vertex: number,
    components: number,
    bytesPerComponent: number,
  ) => {
    const a = raw.accessors[index],
      bv = raw.bufferViews[a.bufferView];
    const start =
      28 +
      n +
      (bv.byteOffset ?? 0) +
      (a.byteOffset ?? 0) +
      vertex * (bv.byteStride ?? components * bytesPerComponent);
    return Array.from({ length: components }, (_, j) =>
      bytesPerComponent === 1
        ? view.getUint8(start + j)
        : bytesPerComponent === 2
          ? view.getUint16(start + j * 2, true)
          : view.getFloat32(start + j * 4, true),
    );
  };
  expect(
    [0, 1, 2].map((offset) =>
      required(rawAccessor(5, 14435 * 3 + offset, 1, 2)[0]),
    ),
  ).toEqual(d.geometryReference.vertexIds);
  for (const vertex of d.geometryReference.vertexIds) {
    expect(rawAccessor(3, vertex, 4, 1)).toEqual([50, 0, 0, 0]);
    expect(rawAccessor(4, vertex, 4, 4)).toEqual([1, 0, 0, 0]);
  }
  expect(d.geometryReference.selectedRadiusM).toBeNull();
  expect(d.geometryReference.exactScaleIdentity).toBe(false);
  expect(accessor(828, 4).hash).toBe(
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
  const { readChineseAerialKneeSource } = await api();
  const altered = input();
  altered.sourceBytes[100] = (altered.sourceBytes[100] ?? 0) ^ 1;
  expect(() => readChineseAerialKneeSource(altered)).toThrow(/hash/);
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
        required(m.clips[17]).attack_and_timeline_events.attack_events[0],
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
        required(m.clips[17]).attack_and_timeline_events.attack_events[0],
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
      required(m.clips[17]).root_motion.root_motion.end_reset = true;
    },
  ]) {
    const original = input();
    const manifest = JSON.parse(original.manifestBytes.toString());
    mutate(manifest);
    expect(() =>
      readChineseAerialKneeSource({
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
  expect(() => readChineseAerialKneeSource(hierarchy)).toThrow(/hash/);
});
test('rejects retimed, shortened, nonfinite or nonnative clocks', async () => {
  const {
    readChineseAerialKneeSource,
    validateChineseAerialKneeAccessorTimes,
  } = await api();
  const t = readChineseAerialKneeSource(input()).sourceTimesSeconds;
  expect(() => validateChineseAerialKneeAccessorTimes(t)).not.toThrow();
  for (const changed of [
    t.slice(1),
    t.map((x) => x / 1.5),
    t.map((x, i) => (i === 25 ? NaN : x)),
    t.map((x, i) => (i === 25 ? x + 0.000001 : x)),
    t.map((x, i) => (i === 25 ? Math.fround(x + 0.001) : x)),
  ])
    expect(() => validateChineseAerialKneeAccessorTimes(changed)).toThrow();
});
