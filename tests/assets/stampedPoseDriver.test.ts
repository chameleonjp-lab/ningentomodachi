import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  type Object3D,
  type Material,
} from 'three';
import { expect, test } from 'vitest';
import type { ActorRig } from '../../src/assets/actorAnimator';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
import {
  actorId,
  clipId,
  durationMs,
  presentationTimeMs,
  runId,
  type StampedDefeatSeek,
} from '../../src/contracts';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}
function qualified(rig: ActorRig<Object3D>) {
  return {
    ...rig,
    seekPose: required(rig.seekPose).bind(rig),
    seekDefeat: required(rig.seekDefeat).bind(rig),
  };
}

// Tiny authored test source, not a runtime substitute for the immutable Android.
function source() {
  const chunks: Uint8Array[] = [];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] =
    [];
  const accessors: {
    bufferView: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[] = [];
  let offset = 0;
  const add = (
    values: number[],
    type: string,
    width: number,
    componentType = 5126,
  ) => {
    const raw =
      componentType === 5126
        ? new Float32Array(values)
        : new Uint16Array(values);
    const data = new Uint8Array(raw.buffer);
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    const index = accessors.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    chunks.push(padded);
    offset += padded.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count: values.length / width,
      type,
    });
    return index;
  };
  const position = add([-0.1, 0, 0, 0.1, 0, 0, 0, 0.2, 0], 'VEC3', 3);
  required(accessors[position]).min = [-0.1, 0, 0];
  required(accessors[position]).max = [0.1, 0.2, 0];
  const joints = add([2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0], 'VEC4', 4, 5123);
  const weights = add([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 'VEC4', 4);
  const indices = add([0, 1, 2], 'SCALAR', 1, 5123);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const binds = add([...identity, ...identity, ...identity], 'MAT4', 16);
  const times = add([0.25, 1], 'SCALAR', 1);
  const track = (node: number, path: string, values: number[]) => ({
    node,
    path,
    output: add(
      values,
      path === 'rotation' ? 'VEC4' : 'VEC3',
      path === 'rotation' ? 4 : 3,
    ),
  });
  const q = [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const definitions = [
    { name: 'Idle', tracks: [track(2, 'rotation', q)] },
    {
      name: 'Walk',
      tracks: [
        track(0, 'translation', [0.4, 0, 0, 1.4, 0, 0]),
        track(1, 'translation', [0, 0, 0, 0, 0.5, 0]),
        track(4, 'translation', [0, 0, 0, 3, 2, 1]),
        track(4, 'rotation', q),
        track(4, 'scale', [1, 1, 1, 2, 3, 4]),
      ],
    },
    { name: 'Run', tracks: [track(2, 'scale', [1, 1, 1, 2, 2, 2])] },
    { name: 'Jump', tracks: [track(0, 'translation', [0.4, 0, 0, 1.4, 2, 0])] },
  ];
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 3, 4] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'pelvis', children: [2] },
      { name: 'hand' },
      { name: 'surface', mesh: 0, skin: 0 },
      { name: 'nonBoneAnimated' },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: position,
              JOINTS_0: joints,
              WEIGHTS_0: weights,
            },
            indices,
          },
        ],
      },
    ],
    skins: [{ joints: [0, 1, 2], inverseBindMatrices: binds, skeleton: 0 }],
    animations: definitions.map((d) => ({
      name: d.name,
      samplers: d.tracks.map((t) => ({
        input: times,
        output: t.output,
        interpolation: 'LINEAR',
      })),
      channels: d.tracks.map((t, index) => ({
        sampler: index,
        target: { node: t.node, path: t.path },
      })),
    })),
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors,
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(12 + 8 + jsonLength + 8 + offset);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(32, 20, 20 + jsonLength);
  json.copy(result, 20);
  result.writeUInt32LE(offset, 20 + jsonLength);
  result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  let at = 28 + jsonLength;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return new Uint8Array(result);
}
const deaths = ['DefeatPunch', 'DefeatKick'].map(
  (name) =>
    new AnimationClip(name, 0.5, [
      new QuaternionKeyframeTrack(
        'pelvis.quaternion',
        [0, 0.5],
        [0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      ),
      new VectorKeyframeTrack(
        'pelvis.position',
        [0, 0.5],
        [0, 0, 0, 0, 0.2, 0],
      ),
    ]),
);
function pose(node: Object3D) {
  const result: number[][] = [];
  node.traverse((part) =>
    result.push([
      ...part.position.toArray(),
      ...part.quaternion.toArray(),
      ...part.scale.toArray(),
    ]),
  );
  return result;
}

test('canonical living sampling resets every partial TRS target independent of prior, repeated and reverse seeks', async () => {
  const pack = await createThreeAssetPack([source()], {}, deaths);
  const a = qualified(pack.create('white')),
    b = qualified(pack.create('white'));
  try {
    expect(pack.poseBindings).toBeDefined();
    expect(a.seekPose).toBeTypeOf('function');
    const bindings = required(pack.poseBindings);
    a.seek(clipId('Walk'), 1);
    for (const name of ['Idle', 'Run', 'Walk', 'Jump', 'Idle']) {
      const binding = required(bindings.clips.find((c) => c.clipId === name));
      for (const t of [1000, 0, 500, 500, 250]) {
        a.seekPose(binding, durationMs(t));
        b.seekPose(binding, durationMs(t));
        const fresh = qualified(pack.create('white'));
        try {
          fresh.seekPose(binding, durationMs(t));
          expect(pose(a.node)).toEqual(pose(fresh.node));
        } finally {
          fresh.dispose();
        }
        expect(pose(a.node)).toEqual(pose(b.node));
      }
    }
    const idle = required(bindings.clips.find((c) => c.clipId === 'Idle'));
    a.seekPose(idle, durationMs(0));
    const first = pose(a.node);
    a.seekPose(idle, durationMs(250));
    expect(pose(a.node)).toEqual(first);
    expect(
      required(a.node.getObjectByName('nonBoneAnimated')).scale.toArray(),
    ).toEqual([1, 1, 1]);
    const before = pose(a.node);
    expect(() =>
      a.seekPose({ ...idle, sourceBindingId: 'wrong' }, durationMs(0)),
    ).toThrow();
    expect(pose(a.node)).toEqual(before);
  } finally {
    a.dispose();
    b.dispose();
    pack.dispose();
  }
});

test('atomic stamped defeat reconstructs skipped entry, preserves replay and rejects provenance conflicts before mutation', async () => {
  const pack = await createThreeAssetPack([source()], {}, deaths);
  const a = qualified(pack.create('white')),
    b = qualified(pack.create('white'));
  try {
    const binding = required(
      required(pack.poseBindings).clips.find((c) => c.clipId === 'Walk'),
    );
    const input: StampedDefeatSeek = {
      runId: runId('run'),
      actorId: actorId('actor'),
      defeatStartedAt: presentationTimeMs(1000),
      deathClipId: clipId('DefeatPunch'),
      deathClipTime: durationMs(200),
      entry: { binding, clipTime: durationMs(1000), sampleSide: 'left' },
    };
    a.seekDefeat(input);
    b.seekPose(binding, durationMs(1000));
    b.seekDefeat({ ...input, deathClipTime: durationMs(0) });
    b.seekDefeat(input);
    expect(pose(a.node)).toEqual(pose(b.node));
    expect(required(a.defeatPoseSupport)()).toEqual(
      required(b.defeatPoseSupport)(),
    );
    const expected = pose(a.node),
      support = required(a.defeatPoseSupport)();
    a.seekPose(binding, durationMs(0));
    a.seekDefeat(input);
    expect(pose(a.node)).toEqual(expected);
    expect(required(a.defeatPoseSupport)()).toEqual(support);
    for (const changed of [
      { ...input, actorId: actorId('other') },
      { ...input, defeatStartedAt: presentationTimeMs(1001) },
      { ...input, entry: { ...input.entry, clipTime: durationMs(999) } },
      { ...input, deathClipTime: durationMs(501) },
    ]) {
      expect(() => a.seekDefeat(changed)).toThrow();
      expect(pose(a.node)).toEqual(expected);
      expect(required(a.defeatPoseSupport)()).toEqual(support);
    }
    a.seekDefeat({ ...input, deathClipTime: durationMs(0) });
    b.seekPose(binding, durationMs(1000));
    expect(pose(a.node)).toEqual(pose(b.node));
  } finally {
    a.dispose();
    b.dispose();
    pack.dispose();
  }
});

test('real original and derived stamped sources agree at every clip endpoint/interior with independent raw source vertices', async () => {
  const { readFileSync } = await import('node:fs');
  const {
    Group,
    Matrix4,
    AnimationMixer,
    LoopOnce,
    SkinnedMesh,
    Vector3,
    Mesh,
  } = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const {
    createPinnedThreeAssetPack,
    createPinnedDerivedThreeAssetPack,
    ANDROID_RUNTIME_ARTIFACT_V1: runtime,
    ANDROID_DERIVED_PACK_V1: derived,
    PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES: policies,
  } = await import('../../src/assets');
  const sources = runtime.sources.map(
    (pin) => new Uint8Array(readFileSync(pin.path)),
  );
  const artifactBytes = new Uint8Array(readFileSync(`public${runtime.url}`));
  const original = await createPinnedThreeAssetPack({
    sources,
    artifactBytes,
    signal: new AbortController().signal,
    rootPolicies: policies,
  });
  let packed:
    | Awaited<ReturnType<typeof createPinnedDerivedThreeAssetPack>>
    | undefined;
  const raw: Awaited<
    ReturnType<InstanceType<typeof GLTFLoader>['parseAsync']>
  >[] = [];
  try {
    packed = await createPinnedDerivedThreeAssetPack({
      derivedBytes: new Uint8Array(readFileSync(`public${derived.url}`)),
      artifactBytes,
      signal: new AbortController().signal,
      rootPolicies: policies,
    });
    expect(packed.poseBindings).toEqual(original.poseBindings);
    const bindings = required(packed.poseBindings);
    expect(bindings.clips).toHaveLength(42);
    for (const bytes of sources)
      raw.push(
        await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, ''),
      );
    const scene = required(raw[0]).scene,
      root = required(scene.getObjectByName('root'));
    const baseline: {
      part: Object3D;
      position: InstanceType<typeof Vector3>;
      rotation: typeof scene.quaternion;
      scale: InstanceType<typeof Vector3>;
    }[] = [];
    scene.traverse((part) =>
      baseline.push({
        part,
        position: part.position.clone(),
        rotation: part.quaternion.clone(),
        scale: part.scale.clone(),
      }),
    );
    const mixer = new AnimationMixer(scene),
      clips = new Map(
        raw.flatMap((item) => item.animations).map((clip) => [clip.name, clip]),
      );
    const rig = qualified(packed.create('white'));
    const parent = new Group();
    parent.position.set(3, 2, -5);
    parent.rotation.set(0.13, 0.6, -0.07);
    parent.scale.set(0.7, 1.3, 1.1);
    parent.add(rig.node);
    parent.updateMatrixWorld(true);
    const actualMeshes: InstanceType<typeof SkinnedMesh>[] = [];
    rig.node.traverse((part) => {
      if (part instanceof SkinnedMesh) actualMeshes.push(part);
    });
    const sourceMeshes: InstanceType<typeof SkinnedMesh>[] = [];
    scene.traverse((part) => {
      if (part instanceof SkinnedMesh) sourceMeshes.push(part);
    });
    expect(actualMeshes.length).toBe(5);
    expect(sourceMeshes.length).toBe(5);
    let maximum = 0,
      vertices = 0;
    try {
      for (const binding of bindings.clips) {
        const clip = required(clips.get(binding.clipId));
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          mixer.stopAllAction();
          for (const pose of baseline) {
            pose.part.position.copy(pose.position);
            pose.part.quaternion.copy(pose.rotation);
            pose.part.scale.copy(pose.scale);
          }
          const action = mixer.clipAction(clip);
          action.reset().setLoop(LoopOnce, 1);
          action.clampWhenFinished = true;
          action.paused = true;
          action.play();
          action.time = 0;
          mixer.update(0);
          scene.updateWorldMatrix(true, true);
          const origin = root.getWorldPosition(new Vector3());
          action.time = clip.duration * fraction;
          mixer.update(0);
          scene.updateWorldMatrix(true, true);
          const transport = root.getWorldPosition(new Vector3()).sub(origin);
          if (
            policies.some(
              (p) =>
                p.clipId === binding.clipId && p.mode === 'grounded-posture-y',
            )
          )
            transport.y = 0;
          rig.seekPose(binding, durationMs(binding.durationMs * fraction));
          rig.node.updateWorldMatrix(true, true);
          const parentInverse = parent.matrixWorld.clone().invert(),
            expected = new Vector3(),
            actual = new Vector3();
          for (let mesh = 0; mesh < sourceMeshes.length; mesh++) {
            const source = required(sourceMeshes[mesh]),
              target = required(actualMeshes[mesh]);
            const count = source.geometry.getAttribute('position').count;
            expect(target.geometry.getAttribute('position').count).toBe(count);
            for (let vertex = 0; vertex < count; vertex++) {
              source
                .getVertexPosition(vertex, expected)
                .applyMatrix4(source.matrixWorld)
                .sub(transport);
              target
                .getVertexPosition(vertex, actual)
                .applyMatrix4(target.matrixWorld)
                .applyMatrix4(parentInverse);
              maximum = Math.max(maximum, expected.distanceTo(actual));
              vertices++;
            }
          }
          expect(maximum, `${binding.clipId}@${fraction}`).toBeLessThan(1e-10);
        }
      }
      expect(vertices).toBe(42 * 5 * 46181);
      console.info(
        JSON.stringify({
          proof: 'stamped-original-derived-source-v1',
          clips: 42,
          poses: 210,
          vertices,
          maximumErrorM: maximum,
          thresholdM: 1e-10,
          bindingSetId: bindings.bindingSetId,
        }),
      );
      // Unchanged inherited physical/facing parent, not a hidden world-height fix.
      expect(parent.position.toArray()).toEqual([3, 2, -5]);
      expect(parent.scale.toArray()).toEqual([0.7, 1.3, 1.1]);
      expect(new Matrix4().copy(parent.matrixWorld).determinant()).not.toBe(0);
    } finally {
      rig.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    }
  } finally {
    original.dispose();
    packed?.dispose();
    for (const gltf of raw) {
      const geometry = new Set<InstanceType<typeof Mesh>['geometry']>(),
        materials = new Set<Material>();
      const skeletons = new Set<InstanceType<typeof SkinnedMesh>['skeleton']>();
      gltf.scene.traverse((part) => {
        if (part instanceof Mesh) {
          geometry.add(part.geometry);
          for (const material of Array.isArray(part.material)
            ? part.material
            : [part.material])
            materials.add(material);
        }
        if (part instanceof SkinnedMesh) skeletons.add(part.skeleton);
      });
      for (const value of geometry) value.dispose();
      for (const value of skeletons) value.dispose();
      for (const value of materials) value.dispose();
    }
  }
}, 60000);

test('left loop endpoint is the source end, invalid raw inputs preserve the existing pose, and owned rigs survive pack release', async () => {
  const { createLivingPoseStamp, poseClipTime, gameTimeMs } = await import(
    '../../src/contracts'
  );
  const pack = await createThreeAssetPack([source()], {}, deaths),
    a = qualified(pack.create('white')),
    b = qualified(pack.create('white'));
  try {
    const binding = required(
      required(pack.poseBindings).clips.find((c) => c.clipId === 'Idle'),
    );
    const stamp = createLivingPoseStamp({
      version: 1,
      binding,
      mode: 'idle',
      startedAt: gameTimeMs(0),
      playback: 'loop',
      activationId: null,
    });
    const end = poseClipTime(stamp, gameTimeMs(1000), 'left');
    expect(end).toBe(1000);
    const input: StampedDefeatSeek = {
      runId: runId('run'),
      actorId: actorId('actor'),
      defeatStartedAt: presentationTimeMs(1000),
      deathClipId: clipId('DefeatKick'),
      deathClipTime: durationMs(0),
      entry: { binding, clipTime: end, sampleSide: 'left' },
    };
    a.seekDefeat(input);
    b.seekPose(binding, end);
    expect(pose(a.node)).toEqual(pose(b.node));
    b.seekPose(binding, durationMs(0));
    expect(pose(a.node)).not.toEqual(pose(b.node));
    const before = pose(a.node),
      observation = required(a.defeatPoseSupport)();
    for (const invalid of [
      null,
      { ...input, deathClipTime: NaN },
      { ...input, deathClipTime: -1 },
      { ...input, defeatStartedAt: Infinity },
      { ...input, entry: null },
      { ...input, entry: { ...input.entry, sampleSide: 'right' } },
      { ...input, entry: { ...input.entry, clipTime: 1001 } },
      {
        ...input,
        entry: { ...input.entry, binding: { ...binding, durationMs: 999 } },
      },
    ]) {
      expect(() => Reflect.apply(a.seekDefeat, a, [invalid])).toThrow();
      expect(pose(a.node)).toEqual(before);
      expect(required(a.defeatPoseSupport)()).toEqual(observation);
    }
    expect(() => a.seek(clipId('Idle'), 0)).toThrow('mix');
    expect(pose(a.node)).toEqual(before);
    pack.dispose();
    expect(() => pack.create('white')).toThrow('disposed');
    a.seekDefeat({ ...input, deathClipTime: durationMs(500) });
    b.seekPose(binding, durationMs(500));
    a.dispose();
    expect(() => a.seekDefeat(input)).toThrow('disposed');
    a.dispose();
  } finally {
    a.dispose();
    b.dispose();
    pack.dispose();
  }
});

test('real stamped defeat retains the accepted entry trajectory, full support, parent isolation and 20ns seam', async () => {
  const { readFileSync } = await import('node:fs');
  const { Group, Matrix4, SkinnedMesh, Vector3 } = await import('three');
  const {
    createPinnedDerivedThreeAssetPack,
    ANDROID_DERIVED_PACK_V1: derived,
    ANDROID_RUNTIME_ARTIFACT_V1: runtime,
    PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES: policies,
  } = await import('../../src/assets');
  const pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: new Uint8Array(readFileSync(`public${derived.url}`)),
    artifactBytes: new Uint8Array(readFileSync(`public${runtime.url}`)),
    signal: new AbortController().signal,
    rootPolicies: policies,
  });
  const bindings = required(pack.poseBindings);
  const vertices = (node: Object3D) => {
    node.updateWorldMatrix(true, true);
    const inverse = node.parent?.matrixWorld.clone().invert() ?? new Matrix4();
    const points: InstanceType<typeof Vector3>[] = [];
    node.traverse((part) => {
      if (part instanceof SkinnedMesh)
        for (let i = 0; i < part.geometry.getAttribute('position').count; i++)
          points.push(
            part
              .getVertexPosition(i, new Vector3())
              .applyMatrix4(part.matrixWorld)
              .applyMatrix4(inverse),
          );
    });
    return points;
  };
  const input = (
    name: string,
    time: number,
    death: string,
    at: number,
  ): StampedDefeatSeek => ({
    runId: runId('source-run'),
    actorId: actorId('source-actor'),
    defeatStartedAt: presentationTimeMs(1000),
    deathClipId: clipId(death),
    deathClipTime: durationMs(at),
    entry: {
      binding: required(bindings.clips.find((b) => b.clipId === name)),
      clipTime: durationMs(time * 1000),
      sampleSide: 'left',
    },
  });
  try {
    for (const [name, time] of [
      ['CartwheelKick', 0.9],
      ['ChineseCartwheelKick', 1.04],
      ['ButterflyKick', 0.94],
      ['DivingLunge', 0.6611110925674438],
    ] as const) {
      for (const death of ['DefeatPunch', 'DefeatKick']) {
        const actual = qualified(pack.create('white')),
          legacy = pack.create('white'),
          parent = new Group();
        parent.position.set(-3, 7, 4);
        parent.rotation.y = 0.7;
        parent.add(actual.node, legacy.node);
        parent.updateMatrixWorld(true);
        const physical = parent.matrixWorld.clone();
        let entry: number | undefined;
        try {
          legacy.seek(clipId(name), time);
          for (const t of [200, 0, 25, 100, 250, 490, 500, 250]) {
            actual.seekDefeat(input(name, time, death, t));
            legacy.seek(clipId(death), t / 1000, presentationTimeMs(1000));
            const a = vertices(actual.node),
              b = vertices(legacy.node);
            let maximum = 0,
              floor = Infinity;
            for (let index = 0; index < a.length; index++) {
              const first = required(a[index]);
              maximum = Math.max(maximum, first.distanceTo(required(b[index])));
              floor = Math.min(floor, first.y);
            }
            expect(maximum, `${name}/${death}@${t}`).toBeLessThan(1e-10);
            const support = required(required(actual.defeatPoseSupport)());
            if (entry === undefined) entry = support.entryLocalMinY;
            expect(support.entryLocalMinY).toBe(entry);
            expect(
              Math.abs(support.currentLocalBounds.min.y - floor),
            ).toBeLessThan(1e-10);
            const axis = required(actual.node.getObjectByName('head'))
              .getWorldPosition(new Vector3())
              .sub(
                required(
                  actual.node.getObjectByName('pelvis'),
                ).getWorldPosition(new Vector3()),
              )
              .normalize();
            expect(axis.y).toBeLessThan(0.5);
            if (t >= 100) expect(floor).toBeGreaterThanOrEqual(-0.003);
            expect(parent.matrixWorld.equals(physical)).toBe(true);
          }
        } finally {
          actual.dispose();
          legacy.dispose();
        }
      }
    }
    const seam = 0.025750979417920462;
    for (const death of ['DefeatPunch', 'DefeatKick']) {
      const a = qualified(pack.create('white')),
        b = qualified(pack.create('white'));
      try {
        a.seekDefeat(input('FrontKick', 0.55, death, (seam - 1e-8) * 1000));
        b.seekDefeat(input('FrontKick', 0.55, death, (seam + 1e-8) * 1000));
        const first = vertices(a.node),
          second = vertices(b.node);
        let maximum = 0;
        for (let i = 0; i < first.length; i++)
          maximum = Math.max(
            maximum,
            required(first[i]).distanceTo(required(second[i])),
          );
        expect(maximum).toBeLessThan(1e-5);
      } finally {
        a.dispose();
        b.dispose();
      }
    }
  } finally {
    pack.dispose();
  }
}, 60000);

test('real new timing-binding cancellation and scheduler rejection dispose already parsed ownership before rejecting', async () => {
  const { readFileSync } = await import('node:fs');
  const { vi } = await import('vitest');
  const { Mesh } = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const {
    createPinnedDerivedThreeAssetPack,
    ANDROID_DERIVED_PACK_V1: derived,
    ANDROID_RUNTIME_ARTIFACT_V1: runtime,
  } = await import('../../src/assets');
  const derivedBytes = new Uint8Array(readFileSync(`public${derived.url}`)),
    artifactBytes = new Uint8Array(readFileSync(`public${runtime.url}`));
  for (const mode of ['abort', 'reject'] as const)
    for (const boundary of [1, 21, 42]) {
      const controller = new AbortController(),
        geometries = new Map<InstanceType<typeof Mesh>['geometry'], number>(),
        materials = new Map<Material, number>();
      const original = GLTFLoader.prototype.parseAsync;
      let parsed = 0,
        count = 0,
        ready = false;
      const parser = vi
        .spyOn(GLTFLoader.prototype, 'parseAsync')
        .mockImplementation(async function (
          this: InstanceType<typeof GLTFLoader>,
          ...args
        ) {
          const result = await original.apply(this, args);
          parsed++;
          result.scene.traverse((part) => {
            if (part instanceof Mesh) {
              const geometry = part.geometry;
              if (!geometries.has(geometry)) {
                geometries.set(geometry, 0);
                geometry.addEventListener('dispose', () =>
                  geometries.set(
                    geometry,
                    required(geometries.get(geometry)) + 1,
                  ),
                );
              }
              for (const material of Array.isArray(part.material)
                ? part.material
                : [part.material])
                if (!materials.has(material)) {
                  materials.set(material, 0);
                  material.addEventListener('dispose', () =>
                    materials.set(
                      material,
                      required(materials.get(material)) + 1,
                    ),
                  );
                }
            }
          });
          return result;
        });
      try {
        await expect(
          createPinnedDerivedThreeAssetPack({
            derivedBytes,
            artifactBytes,
            signal: controller.signal,
            checkpoint: async (stage) => {
              if (stage === 'pack:ready') ready = true;
              if (stage === 'pose:binding' && ++count === boundary) {
                if (mode === 'abort') controller.abort();
                else throw new Error('Injected binding scheduler rejection');
              }
            },
          }),
        ).rejects.toThrow(mode === 'abort' ? 'aborted' : 'scheduler rejection');
        expect(parsed).toBe(1);
        expect(count).toBe(boundary);
        expect(ready).toBe(false);
        expect(geometries.size).toBe(5);
        expect(materials.size).toBe(5);
        expect([...geometries.values()]).toEqual([1, 1, 1, 1, 1]);
        expect([...materials.values()]).toEqual([1, 1, 1, 1, 1]);
      } finally {
        parser.mockRestore();
      }
    }
}, 30000);
