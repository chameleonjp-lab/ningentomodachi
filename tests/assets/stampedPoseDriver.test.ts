import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Object3D,
  SkinnedMesh,
  Vector3,
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
function source(includeRecovery = false, includeStartup = false) {
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
  if (includeRecovery)
    definitions.push({
      name: 'KungFuStraight',
      tracks: [track(2, 'rotation', q)],
    });
  if (includeStartup)
    definitions.push({ name: 'SideKick', tracks: [track(2, 'rotation', q)] });
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: includeRecovery ? [5] : [0, 3, 4] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'pelvis', children: [2] },
      { name: 'hand' },
      { name: 'surface', mesh: 0, skin: 0 },
      { name: 'nonBoneAnimated' },
      ...(includeRecovery
        ? [{ name: 'stage2Hierarchy', children: [0, 3, 4] }]
        : []),
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

import {
  createLivingPoseStamp,
  createRecoveryPoseEpoch,
  attackActivationId,
  gameTimeMs,
} from '../../src/contracts';
import { Group, Mesh, Matrix4 } from 'three';
import { createPrivatePoseHierarchy } from '../../src/assets/threeAssetPack';
import {
  prepareSkinBounds,
  createSkinBounds,
} from '../../src/assets/skinBounds';
function syntheticEpoch(
  pack: Awaited<ReturnType<typeof createThreeAssetPack>>,
) {
  const bindings = required(pack.poseBindings),
    binding = (name: string) =>
      required(bindings.clips.find((b) => b.clipId === name));
  return createRecoveryPoseEpoch({
    runId: runId('stage2'),
    actorId: actorId('white'),
    outgoing: createLivingPoseStamp({
      version: 1,
      binding: binding('KungFuStraight'),
      mode: 'attack',
      startedAt: gameTimeMs(0),
      playback: 'clamp',
      activationId: attackActivationId('hit'),
    }),
    destination: createLivingPoseStamp({
      version: 1,
      binding: binding('Idle'),
      mode: 'idle',
      startedAt: gameTimeMs(1000),
      playback: 'loop',
      activationId: null,
    }),
  });
}
test('synthetic stage2 private hierarchy has no mesh clones and matches matrix support under nontrivial parent', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white');
  try {
    const plan = prepareSkinBounds(rig.node),
      privateRig = createPrivatePoseHierarchy(rig.node, plan);
    const parent = new Group();
    parent.position.set(4, 2, -7);
    parent.rotation.y = 0.7;
    parent.add(rig.node);
    parent.updateMatrixWorld(true);
    privateRig.node.updateMatrixWorld(true);
    let meshes = 0;
    privateRig.node.traverse((n) => {
      if (n instanceof Mesh) meshes++;
    });
    expect(meshes).toBe(0);
    expect(privateRig.stats.meshClones).toBe(0);
    expect(privateRig.stats.sourceVertices).toBe(3);
    expect(privateRig.stats.transformNodes).toBe(7);
    expect(privateRig.stats.retainedSupportPoints).toBe(3);
    expect(privateRig.stats.transformNumericBytesEstimate).toBe(2352);
    expect(privateRig.stats.sharedSupportNumericBytesEstimate).toBe(400);
    const visible = createSkinBounds(rig.node, plan).measure(
      new Matrix4().copy(rig.node.matrixWorld).invert(),
    );
    const hidden = privateRig.bounds.measure(
      new Matrix4().copy(privateRig.node.matrixWorld).invert(),
    );
    expect(hidden.min.y).toBeCloseTo(visible.min.y, 12);
    expect(hidden.max.x).toBeCloseTo(visible.max.x, 12);
    privateRig.dispose();
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('synthetic stage2 recovery preparation leaves visible TRS and physical parent untouched until apply', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white');
  try {
    const parent = new Group();
    parent.position.set(4, 2, -7);
    parent.rotation.y = 0.7;
    parent.add(rig.node);
    parent.updateMatrixWorld(true);
    const epoch = syntheticEpoch(pack),
      driver = required(rig.poseFrame),
      before = pose(rig.node),
      parentBefore = parent.matrixWorld.toArray();
    const command = driver.prepare({
      kind: 'living',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 1,
      epoch,
      at: gameTimeMs(1075),
      side: 'right',
    });
    expect(pose(rig.node)).toEqual(before);
    expect(parent.matrixWorld.toArray()).toEqual(parentBefore);
    driver.apply(command);
    expect(pose(rig.node)).not.toEqual(before);
    expect(parent.matrixWorld.toArray()).toEqual(parentBefore);
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('synthetic stage2 composite defeat zero retains recovery left pose and support', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white');
  try {
    const epoch = syntheticEpoch(pack),
      driver = required(rig.poseFrame);
    driver.apply(
      driver.prepare({
        kind: 'living',
        runId: epoch.runId,
        actorId: epoch.actorId,
        revision: 1,
        epoch,
        at: gameTimeMs(1075),
        side: 'left',
      }),
    );
    const entry = pose(rig.node);
    const command = driver.prepare({
      kind: 'defeat',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 2,
      input: {
        runId: epoch.runId,
        actorId: epoch.actorId,
        defeatStartedAt: presentationTimeMs(2000),
        deathClipId: clipId('DefeatPunch'),
        deathClipTime: durationMs(0),
        entry: {
          kind: 'recovery',
          epoch,
          at: gameTimeMs(1075),
          sampleSide: 'left',
        },
      },
    });
    expect(pose(rig.node)).toEqual(entry);
    driver.apply(command);
    const after = pose(rig.node);
    after.forEach((row, i) => {
      row.forEach((n, j) => {
        expect(n).toBeCloseTo(required(required(entry[i])[j]), 12);
      });
    });
    expect(rig.defeatPoseSupport?.()).toBeDefined();
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('synthetic stage2 owned prepared actor survives pack disposal but rejects after actor disposal', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    epoch = syntheticEpoch(pack),
    driver = required(rig.poseFrame);
  pack.dispose();
  try {
    const token = driver.prepare({
      kind: 'living',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 1,
      epoch,
      at: gameTimeMs(1075),
      side: 'right',
    });
    driver.apply(token);
    rig.dispose();
    expect(() => driver.apply(token)).toThrow();
    expect(() => pack.create('white')).toThrow();
  } finally {
    rig.dispose();
  }
});

test('synthetic stage2 R2 CPU stage transfers the exact prepared driver without a second source sample', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    epoch = syntheticEpoch(pack),
    stage = required(pack.stageActor)('white');
  let rig: ActorRig<Object3D> | undefined;
  try {
    const token = stage.poseFrame.prepare({
      kind: 'living',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 2,
      epoch,
      at: gameTimeMs(1075),
      side: 'right',
    });
    rig = stage.materialize();
    expect(rig.poseFrame).toBe(stage.poseFrame);
    stage.poseFrame.apply(token);
    expect(() => stage.poseFrame.apply(token)).toThrow('consumed');
    expect(() => stage.materialize()).toThrow();
    stage.dispose();
    expect(() =>
      stage.poseFrame.prepare({
        kind: 'living',
        runId: epoch.runId,
        actorId: epoch.actorId,
        revision: 1,
        epoch,
        at: gameTimeMs(1050),
        side: 'right',
      }),
    ).not.toThrow();
    rig.dispose();
    expect(() => stage.poseFrame.apply(token)).toThrow();
  } finally {
    rig?.dispose();
    stage.dispose();
    pack.dispose();
  }
});
test('synthetic stage2 R2 abandoned CPU stage revokes receipt without creating display geometry', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    epoch = syntheticEpoch(pack),
    stage = required(pack.stageActor)('white');
  try {
    const token = stage.poseFrame.prepare({
      kind: 'living',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 1,
      epoch,
      at: gameTimeMs(1075),
      side: 'right',
    });
    stage.dispose();
    expect(() => stage.materialize()).toThrow();
    expect(() => stage.poseFrame.apply(token)).toThrow();
  } finally {
    stage.dispose();
    pack.dispose();
  }
});
test('synthetic stage2 R2 default bounds use zero matrix clones while opt-in snapshots match exactly', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white');
  try {
    rig.node.updateMatrixWorld(true);
    const plan = prepareSkinBounds(rig.node),
      legacy = createSkinBounds(rig.node, plan),
      privateRig = createPrivatePoseHierarchy(rig.node, plan);
    privateRig.node.updateMatrixWorld(true);
    const inverse = new Matrix4();
    let clones = 0;
    const original = Matrix4.prototype.clone;
    Matrix4.prototype.clone = function () {
      clones++;
      return original.call(this);
    };
    try {
      const direct = legacy.measure(inverse);
      expect(clones).toBe(0);
      const snapshot = privateRig.bounds.measure(inverse);
      expect(clones).toBeGreaterThan(0);
      expect(snapshot).toEqual(direct);
    } finally {
      Matrix4.prototype.clone = original;
      privateRig.dispose();
    }
  } finally {
    rig.dispose();
    pack.dispose();
  }
});

import { AnimationMixer } from 'three';
import { vi } from 'vitest';
import type { PoseFrameRequest } from '../../src/assets/poseFramePreparation';

function canonicalRequest(
  pack: Awaited<ReturnType<typeof createThreeAssetPack>>,
  at: number,
  name = 'Idle',
  owner = 'white',
  side: 'left' | 'right' = 'right',
): Extract<PoseFrameRequest, { kind: 'living' }> {
  return {
    kind: 'living',
    runId: runId('canonical-reuse'),
    actorId: actorId(owner),
    revision: 1,
    epoch: createLivingPoseStamp({
      version: 1,
      binding: required(
        pack.poseBindings?.clips.find((b) => b.clipId === name),
      ),
      mode: 'idle',
      startedAt: gameTimeMs(0),
      playback: 'loop',
      activationId: null,
    }),
    at: gameTimeMs(at),
    side,
  };
}

// Observe real mixer construction and release; delegate every mixer operation.
// An injected callback exercises exceptional/reentrant ownership, not pose math.
function observePrivateEvaluators() {
  const roots = new Set<Object3D>(),
    live = new Set<Object3D>(),
    releases = new Map<Object3D, number>();
  let peak = 0,
    updates = 0,
    beforeUpdate: (() => void) | undefined;
  const privateRoot = (root: Object3D) => {
    let mesh = false;
    root.traverse((part) => {
      if (part instanceof Mesh) mesh = true;
    });
    return !mesh;
  };
  // This installed Three version initializes its memory manager exactly once
  // from the constructor after assigning the root. No production test API.
  const prototype = AnimationMixer.prototype as AnimationMixer & {
      _initMemoryManager(): void;
    },
    initialize = prototype._initMemoryManager,
    update = AnimationMixer.prototype.update,
    uncache = AnimationMixer.prototype.uncacheRoot;
  const constructorSpy = vi
    .spyOn(prototype, '_initMemoryManager')
    .mockImplementation(function (this: AnimationMixer) {
      const root = this.getRoot();
      if (root instanceof Object3D && privateRoot(root)) {
        roots.add(root);
        live.add(root);
        peak = Math.max(peak, live.size);
      }
      return initialize.call(this);
    });
  const updateSpy = vi
    .spyOn(AnimationMixer.prototype, 'update')
    .mockImplementation(function (this: AnimationMixer, delta) {
      const root = this.getRoot();
      if (root instanceof Object3D && roots.has(root)) {
        updates++;
        beforeUpdate?.();
      }
      return update.call(this, delta);
    });
  const uncacheSpy = vi
    .spyOn(AnimationMixer.prototype, 'uncacheRoot')
    .mockImplementation(function (this: AnimationMixer, root) {
      if (root instanceof Object3D && roots.has(root)) {
        releases.set(root, (releases.get(root) ?? 0) + 1);
        live.delete(root);
      }
      return uncache.call(this, root);
    });
  return {
    roots,
    live,
    releases,
    get peak() {
      return peak;
    },
    get updates() {
      return updates;
    },
    set beforeUpdate(value: (() => void) | undefined) {
      beforeUpdate = value;
    },
    restore() {
      constructorSpy.mockRestore();
      updateSpy.mockRestore();
      uncacheSpy.mockRestore();
    },
  };
}

test('canonical reuse samples every advancing Idle clock on one retained private graph', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    driver = required(rig.poseFrame),
    observed = observePrivateEvaluators();
  try {
    const request = canonicalRequest(pack, 500);
    driver.apply(driver.prepare(request));
    const first = pose(rig.node);
    driver.apply(driver.prepare({ ...request, at: gameTimeMs(750) }));
    expect(pose(rig.node)).not.toEqual(first);
    expect(observed.roots.size).toBe(1);
    expect(observed.updates).toBe(4);
    expect(observed.live.size).toBe(1);
    expect(observed.releases.size).toBe(0);
  } finally {
    rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse resets clip and actor alternation with exact repeat and reverse parity against fresh rigs', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    actors = [pack.create('white'), pack.create('white')],
    observed = observePrivateEvaluators();
  try {
    for (const [index, name, at] of [
      [0, 'Walk', 750],
      [1, 'Run', 900],
      [0, 'Idle', 700],
      [1, 'Jump', 500],
      [0, 'Idle', 700],
      [1, 'Idle', 250],
      [0, 'Walk', 500],
    ] as const) {
      const rig = required(actors[index]),
        driver = required(rig.poseFrame),
        fresh = qualified(pack.create('white'));
      try {
        const request = canonicalRequest(pack, at, name, `actor-${index}`);
        driver.apply(driver.prepare(request));
        fresh.seekPose(
          required(pack.poseBindings?.clips.find((b) => b.clipId === name)),
          durationMs(at),
        );
        expect(pose(rig.node)).toEqual(pose(fresh.node));
      } finally {
        fresh.dispose();
      }
    }
    expect(observed.roots.size).toBe(1);
    expect(observed.updates).toBe(14);
  } finally {
    for (const rig of actors) rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse preserves raw quaternion endpoint values and both loop seam sides', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    driver = required(rig.poseFrame),
    observed = observePrivateEvaluators();
  try {
    driver.apply(
      driver.prepare(canonicalRequest(pack, 1000, 'Idle', 'white', 'left')),
    );
    expect(
      required(rig.node.getObjectByName('hand')).quaternion.toArray(),
    ).toEqual(Array.from(new Float32Array([0, 0, Math.SQRT1_2, Math.SQRT1_2])));
    driver.apply(driver.prepare(canonicalRequest(pack, 1000)));
    expect(
      required(rig.node.getObjectByName('hand')).quaternion.toArray(),
    ).toEqual([0, 0, 0, 1]);
    driver.apply(
      driver.prepare(canonicalRequest(pack, 2000, 'Idle', 'white', 'left')),
    );
    expect(
      required(rig.node.getObjectByName('hand')).quaternion.toArray(),
    ).toEqual(Array.from(new Float32Array([0, 0, Math.SQRT1_2, Math.SQRT1_2])));
    expect(observed.roots.size).toBe(1);
  } finally {
    rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse validates every requested palette even when a White evaluator is already cached', async () => {
  const palette = {
      armorRgb: [0.1, 0.2, 0.3] as [number, number, number],
      emissiveRgb: [0, 0, 0] as [number, number, number],
      inlayBaseRgb: [0, 0, 0] as [number, number, number],
      emissiveStrength: 1,
      sourceSha256: 'a'.repeat(64),
    },
    palettes = { black: palette, white: { ...palette } },
    pack = await createThreeAssetPack([source(true)], palettes, deaths),
    white = pack.create('white'),
    black = pack.create('black'),
    missing = required(pack.stageActor)('blue'),
    observed = observePrivateEvaluators();
  try {
    required(white.poseFrame).prepare(canonicalRequest(pack, 500));
    const driver = required(black.poseFrame),
      request = canonicalRequest(pack, 500, 'Idle', 'black');
    const token = driver.prepare(request);
    for (const field of ['armorRgb', 'emissiveRgb', 'inlayBaseRgb'] as const) {
      const prior = palette[field];
      palette[field] = [NaN, 0, 0];
      expect(() => driver.prepare(request)).toThrow('palette');
      palette[field] = prior;
    }
    palette.emissiveStrength = -1;
    expect(() => driver.prepare(request)).toThrow('palette');
    palette.emissiveStrength = 1;
    palette.sourceSha256 = 'invalid';
    expect(() => driver.prepare(request)).toThrow('palette');
    palette.sourceSha256 = 'a'.repeat(64);
    palettes.white.sourceSha256 = 'invalid';
    expect(() =>
      required(white.poseFrame).prepare(canonicalRequest(pack, 500)),
    ).toThrow('palette');
    palettes.white.sourceSha256 = 'a'.repeat(64);
    expect(() =>
      missing.poseFrame.prepare(canonicalRequest(pack, 500, 'Idle', 'blue')),
    ).toThrow('palette');
    expect(() => driver.apply(token)).toThrow('superseded');
    driver.apply(driver.prepare(request));
    expect(observed.roots.size).toBe(1);
    expect(observed.updates).toBe(6);
  } finally {
    missing.dispose();
    white.dispose();
    black.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse evicts a poisoned sample and invalidates prior receipts before a fresh retry', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    driver = required(rig.poseFrame),
    observed = observePrivateEvaluators();
  try {
    const request = canonicalRequest(pack, 750),
      token = driver.prepare(request),
      before = pose(rig.node);
    observed.beforeUpdate = () => {
      observed.beforeUpdate = undefined;
      throw Error('Injected poisoned sample');
    };
    expect(() => driver.prepare(request)).toThrow('Injected poisoned sample');
    expect(observed.roots.size).toBe(1);
    expect(observed.live.size).toBe(0);
    expect([...observed.releases.values()]).toEqual([1]);
    expect(() => driver.apply(token)).toThrow('superseded');
    expect(pose(rig.node)).toEqual(before);
    driver.apply(driver.prepare(request));
    expect(pose(rig.node)).not.toEqual(before);
    expect(observed.roots.size).toBe(2);
    expect(observed.peak).toBe(1);
  } finally {
    rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse rejects nested borrow without evicting the active outer evaluator', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    first = pack.create('white'),
    second = pack.create('white'),
    observed = observePrivateEvaluators();
  try {
    observed.beforeUpdate = () => {
      observed.beforeUpdate = undefined;
      expect(() =>
        required(second.poseFrame).prepare(
          canonicalRequest(pack, 900, 'Idle', 'second'),
        ),
      ).toThrow('already borrowed');
      expect(observed.releases.size).toBe(0);
      expect(observed.live.size).toBe(1);
    };
    const driver = required(first.poseFrame);
    driver.apply(driver.prepare(canonicalRequest(pack, 750)));
    driver.apply(driver.prepare(canonicalRequest(pack, 500)));
    expect(observed.roots.size).toBe(1);
    expect(observed.updates).toBe(4);
    expect(observed.releases.size).toBe(0);
  } finally {
    first.dispose();
    second.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse pack close releases its idle graph and shared source exactly once without self-retention', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    observed = observePrivateEvaluators();
  let geometryDisposals = 0;
  rig.node.traverse((part) => {
    if (part instanceof Mesh)
      part.geometry.addEventListener('dispose', () => geometryDisposals++);
  });
  try {
    required(rig.poseFrame).prepare(canonicalRequest(pack, 750));
    rig.dispose();
    expect(observed.live.size).toBe(1);
    expect(geometryDisposals).toBe(0);
    pack.dispose();
    pack.dispose();
    expect(observed.live.size).toBe(0);
    expect([...observed.releases.values()]).toEqual([1]);
    expect(geometryDisposals).toBe(1);
  } finally {
    rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse pack close during borrow lets an alive caller finish then uses fresh ephemeral fallbacks', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    stage = required(pack.stageActor)('white'),
    driver = required(rig.poseFrame),
    request = canonicalRequest(pack, 750),
    observed = observePrivateEvaluators();
  try {
    observed.beforeUpdate = () => {
      observed.beforeUpdate = undefined;
      const active = required([...observed.live][0]);
      pack.dispose();
      expect(observed.releases.size).toBe(0);
      expect(observed.live.size).toBe(1);
      expect(() => pack.create('white')).toThrow('disposed');
      // Admission is already closed while the original borrow remains active:
      // an authorized stage gets a separate ephemeral graph, not the old slot.
      stage.poseFrame.prepare({ ...request, actorId: actorId('stage') });
      expect(observed.releases.has(active)).toBe(false);
      expect(observed.live.size).toBe(1);
      expect(observed.peak).toBe(2);
    };
    driver.apply(driver.prepare(request));
    const completed = pose(rig.node);
    expect(observed.live.size).toBe(0);
    expect([...observed.releases.values()]).toEqual([1, 1]);
    driver.apply(driver.prepare(request));
    expect(pose(rig.node)).toEqual(completed);
    stage.poseFrame.prepare({ ...request, actorId: actorId('stage') });
    expect(observed.roots.size).toBe(4);
    expect([...observed.releases.values()]).toEqual([1, 1, 1, 1]);
    expect(observed.live.size).toBe(0);
    expect(observed.peak).toBe(2);
  } finally {
    rig.dispose();
    stage.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse detached receipts survive other actors and allow fresh historical requests but not old or foreign tokens', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    first = pack.create('white'),
    second = pack.create('white'),
    a = required(first.poseFrame),
    b = required(second.poseFrame),
    observed = observePrivateEvaluators();
  try {
    const request = canonicalRequest(pack, 500),
      token = a.prepare(request),
      before = pose(first.node);
    b.apply(b.prepare(canonicalRequest(pack, 900, 'Walk', 'second')));
    expect(pose(first.node)).toEqual(before);
    expect(Object.isFrozen(token)).toBe(true);
    expect(() => b.apply(token)).toThrow();
    a.apply(token);
    const early = pose(first.node);
    const old = a.prepare(request);
    a.apply(a.prepare({ ...request, at: gameTimeMs(900), revision: 99 }));
    expect(() => a.apply(old)).toThrow('superseded');
    a.apply(a.prepare(request));
    expect(pose(first.node)).toEqual(early);
    expect(() =>
      a.prepare({ ...request, actorId: actorId('foreign') }),
    ).toThrow('foreign');
    first.dispose();
    expect(() => a.prepare(request)).toThrow('disposed');
    expect(observed.roots.size).toBe(1);
  } finally {
    first.dispose();
    second.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse stage transfer keeps its receipt without resampling and retirement releases owned resources', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    stage = required(pack.stageActor)('white'),
    abandoned = required(pack.stageActor)('white'),
    observed = observePrivateEvaluators();
  let rig: ActorRig<Object3D> | undefined;
  try {
    const request = canonicalRequest(pack, 750),
      token = stage.poseFrame.prepare(request);
    rig = stage.materialize();
    expect(observed.updates).toBe(2);
    required(rig.poseFrame).apply(token);
    abandoned.poseFrame.prepare({ ...request, actorId: actorId('abandoned') });
    abandoned.dispose();
    expect(() => abandoned.poseFrame.prepare(request)).toThrow('disposed');
    stage.dispose();
    required(rig.poseFrame).prepare(request);
    pack.dispose();
    expect(observed.live.size).toBe(0);
    rig.dispose();
    expect(() => stage.poseFrame.apply(token)).toThrow('disposed');
    expect(observed.roots.size).toBe(1);
    expect([...observed.releases.values()]).toEqual([1]);
  } finally {
    rig?.dispose();
    stage.dispose();
    abandoned.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse leaves default-off legacy and direct stamped seeks with zero private allocations', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    legacy = pack.create('white'),
    stamped = qualified(pack.create('white')),
    observed = observePrivateEvaluators();
  try {
    legacy.seek(clipId('Idle'), 0.5);
    legacy.seek(clipId('Walk'), 0.75);
    stamped.seekPose(
      required(pack.poseBindings?.clips.find((b) => b.clipId === 'Idle')),
      durationMs(750),
    );
    expect(observed.roots.size).toBe(0);
    expect(observed.updates).toBe(0);
    expect(observed.live.size).toBe(0);
  } finally {
    legacy.dispose();
    stamped.dispose();
    pack.dispose();
    observed.restore();
  }
});

test('canonical reuse retains at most one graph alongside unchanged ephemeral recovery and defeat preparations', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    driver = required(rig.poseFrame),
    observed = observePrivateEvaluators();
  try {
    const epoch = syntheticEpoch(pack),
      request = canonicalRequest(pack, 750, 'Idle', 'white');
    // Match recovery authority while keeping the canonical clock unchanged.
    driver.apply(driver.prepare({ ...request, runId: epoch.runId }));
    const before = pose(rig.node);
    const recovery = driver.prepare({
      kind: 'living',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 2,
      epoch,
      at: gameTimeMs(1075),
      side: 'left',
    });
    expect(pose(rig.node)).toEqual(before);
    driver.apply(recovery);
    const entry = pose(rig.node);
    const defeat = driver.prepare({
      kind: 'defeat',
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 3,
      input: {
        runId: epoch.runId,
        actorId: epoch.actorId,
        defeatStartedAt: presentationTimeMs(2000),
        deathClipId: clipId('DefeatPunch'),
        deathClipTime: durationMs(0),
        entry: {
          kind: 'recovery',
          epoch,
          at: gameTimeMs(1075),
          sampleSide: 'left',
        },
      },
    });
    expect(pose(rig.node)).toEqual(entry);
    driver.apply(defeat);
    expect(observed.roots.size).toBe(3);
    expect(observed.peak).toBe(2);
    expect(observed.live.size).toBe(1);
    expect([...observed.releases.values()]).toEqual([1, 1]);
    driver.apply(driver.prepare({ ...request, runId: epoch.runId }));
    expect(pose(rig.node)).toEqual(before);
    expect(observed.roots.size).toBe(3);
    for (const root of observed.roots)
      root.traverse((part) => expect(part).not.toBeInstanceOf(Mesh));
    pack.dispose();
    expect(observed.live.size).toBe(0);
    expect([...observed.releases.values()]).toEqual([1, 1, 1]);
  } finally {
    rig.dispose();
    pack.dispose();
    observed.restore();
  }
});

import { captureCanonicalQuery } from '../../src/assets/recoveryDiagnostic';
import { STARTUP_FRAME_CAPABILITY_V2 } from '../../src/assets/poseFramePreparation';
test('startup pack advertises explicit shared-layer capability on visible and staged drivers', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = pack.create('white'),
    stage = required(pack.stageActor)('white');
  try {
    expect(pack.startupCapability).toEqual(STARTUP_FRAME_CAPABILITY_V2);
    expect(rig.poseFrame?.startupCapability).toEqual(
      STARTUP_FRAME_CAPABILITY_V2,
    );
    expect(stage.poseFrame.startupCapability).toEqual(
      STARTUP_FRAME_CAPABILITY_V2,
    );
  } finally {
    stage.dispose();
    rig.dispose();
    pack.dispose();
  }
});
test('startup matrix layer preserves nonidentity outer base and affects mesh and bones once', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = qualified(pack.create('white')),
    parent = new Group();
  try {
    parent.position.set(4, 5, 6);
    parent.rotation.y = 0.7;
    parent.add(rig.node);
    rig.node.position.set(0.3, 0.4, 0.5);
    rig.node.quaternion.set(0.1, 0.2, 0.05, 0.96);
    rig.node.scale.set(2, 3, 4);
    rig.node.updateMatrix();
    const base = rig.node.matrix.clone();
    const request = canonicalRequest(pack, 500),
      diag = required(rig.recoveryDiagnostic);
    const sample = diag.sampleCanonical(
      captureCanonicalQuery(request.epoch as any, request.at, 'right'),
    );
    const rawPose = sample.pose.map((n) => ({
      ...n,
      q: [0.1, 0.2, 0.05, 0.96],
      s: [1.2, 1.5, 2],
    }));
    diag.apply(rawPose);
    const before = startupVertices(rig.node).map((v) => v.clone());
    const layer = new Matrix4().makeRotationY(0.45);
    diag.apply(rawPose, layer.toArray([]));
    parent.updateMatrixWorld(true);
    expect(rig.node.matrix.toArray([])).toEqual(
      layer.clone().multiply(base).toArray([]),
    );
    const expected = before.map((v) => v.clone().applyMatrix4(layer)),
      after = startupVertices(rig.node);
    // vertices helper returns model-parent coordinates; independent layer acts once.
    after.forEach((v, i) => {
      expect(v.distanceTo(required(expected[i]))).toBeLessThan(1e-10);
    });
    expect(parent.position.toArray([])).toEqual([4, 5, 6]);
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('startup layer resets on canonical seek and diagnostic canonical sampling', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = qualified(pack.create('white'));
  try {
    const r = canonicalRequest(pack, 500),
      diag = required(rig.recoveryDiagnostic),
      q = captureCanonicalQuery(r.epoch as any, r.at, 'right'),
      sample = diag.sampleCanonical(q),
      before = startupVertices(rig.node);
    diag.apply(sample.pose, new Matrix4().makeRotationY(0.5).toArray([]));
    expect(rig.node.matrixAutoUpdate).toBe(false);
    rig.seekPose(q.stamp.binding, q.clipTime);
    expect(rig.node.matrixAutoUpdate).toBe(true);
    expect(startupVertices(rig.node)).toEqual(before);
    diag.apply(sample.pose, new Matrix4().makeRotationY(0.5).toArray([]));
    expect(diag.sampleCanonical(q).pose).toEqual(sample.pose);
    expect(rig.node.matrixAutoUpdate).toBe(true);
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('startup invalid layer rejects before any visible local writes', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = qualified(pack.create('white'));
  try {
    const r = canonicalRequest(pack, 500),
      diag = required(rig.recoveryDiagnostic),
      sample = diag.sampleCanonical(
        captureCanonicalQuery(r.epoch as any, r.at, 'right'),
      ),
      before = startupVertices(rig.node);
    const layer = new Matrix4().toArray([] as number[]);
    layer[3] = 1;
    expect(() =>
      diag.apply(
        sample.pose.map((n) => ({ ...n, t: [9, 8, 7] })),
        layer,
      ),
    ).toThrow(/layer/i);
    expect(startupVertices(rig.node)).toEqual(before);
  } finally {
    rig.dispose();
    pack.dispose();
  }
});

function startupVertices(node: Object3D) {
  // Refresh attached skin bind inverses as the render traversal does.
  (node.parent ?? node).updateMatrixWorld(true);
  const inverse = node.parent?.matrixWorld.clone().invert() ?? new Matrix4();
  const out: Vector3[] = [];
  node.traverse((p) => {
    if (p instanceof SkinnedMesh) {
      p.skeleton.update();
      for (let i = 0; i < p.geometry.attributes.position!.count; i++)
        out.push(
          p
            .getVertexPosition(i, new Vector3())
            .applyMatrix4(p.matrixWorld)
            .applyMatrix4(inverse),
        );
    }
  });
  return out;
}

// SYNTHETIC structural adapter only. Trusted preparation seams supply declared
// metadata to exercise consumers; these tiny bytes are not source authorization.
async function syntheticStartupPack() {
  const { prepareThreeAssetPack } = await import(
    '../../src/assets/threeAssetPack'
  );
  const { prepareSkinBounds } = await import('../../src/assets/skinBounds');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { STARTUP_SOURCES } = await import('../../src/contracts');
  const hash =
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd';
  const policy = {
    version: 1 as const,
    clipId: clipId('SideKick'),
    sourceSha256: hash,
    mode: 'grounded-posture-y' as const,
    provenance: {
      manifestSha256:
        'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
      clipPointer: '/clips/1',
      supportPointer: '/clips/1/support_contacts/support/0',
    },
  };
  const pack = await prepareThreeAssetPack(
    [source(true, true)],
    {},
    deaths,
    [policy],
    {
      checkpoint: async () => {},
      support: async (t) => prepareSkinBounds(t),
      verifyPolicy: async (p) => {
        expect(p).toEqual(policy);
      },
      poseOrigin: (name, _source, index) => ({
        sourceSha256: name === 'SideKick' ? hash : 'a'.repeat(64),
        sourceClipIndex: name === 'SideKick' ? 1 : index,
      }),
      parse: async (bytes) => {
        const loaded = await new GLTFLoader().parseAsync(
          new Uint8Array(bytes).buffer,
          '',
        );
        required(
          loaded.animations.find((c) => c.name === 'SideKick'),
        ).duration = STARTUP_SOURCES.SideKick.binding.durationMs / 1000;
        return loaded;
      },
    },
  );
  expect(
    required(pack.poseBindings).clips.find((b) => b.clipId === 'SideKick'),
  ).toEqual(STARTUP_SOURCES.SideKick.binding);
  return pack;
}
async function syntheticStartupEpoch(
  pack: Awaited<ReturnType<typeof syntheticStartupPack>>,
) {
  const { createStartupPoseEpoch, STARTUP_SOURCES } = await import(
    '../../src/contracts'
  );
  return createStartupPoseEpoch({
    runId: runId('synthetic-startup'),
    actorId: actorId('white'),
    outgoing: createLivingPoseStamp({
      version: 1,
      binding: required(
        required(pack.poseBindings).clips.find(
          (b) => b.clipId === required(pack.poseBindings).locomotion.idle,
        ),
      ),
      mode: 'idle',
      startedAt: gameTimeMs(0),
      playback: 'loop',
      activationId: null,
    }),
    destination: createLivingPoseStamp({
      version: 1,
      binding: STARTUP_SOURCES.SideKick.binding,
      mode: 'attack',
      startedAt: gameTimeMs(1000),
      playback: 'clamp',
      activationId: attackActivationId('kick'),
    }),
    basis: {
      authority: 'activation-stance-v1',
      oldYaw: 0,
      admittedYaw: Math.PI / 2,
    },
    policy: {
      version: 1,
      protocol: 'side-kick-startup-matrix-v1',
      durationMs: durationMs(100),
      fixedLiftSign: 1,
    },
  });
}
test('startup synthetic staged entry death freezes layer across reverse and repeat seeks', async () => {
  const pack = await syntheticStartupPack(),
    rig = pack.create('white'),
    direct = pack.create('white');
  try {
    const epoch = await syntheticStartupEpoch(pack),
      frame = required(rig.poseFrame),
      entryAt = gameTimeMs(1050);
    const living = {
      runId: epoch.runId,
      actorId: epoch.actorId,
      revision: 1,
      kind: 'living' as const,
      epoch,
      at: entryAt,
      side: 'left' as const,
    };
    frame.apply(frame.prepare(living));
    const entryMatrix = rig.node.matrix.toArray([]),
      entryVertices = startupVertices(rig.node),
      entryPose = pose(rig.node);
    const request = (time: number): StampedDefeatSeek => ({
      runId: epoch.runId,
      actorId: epoch.actorId,
      defeatStartedAt: presentationTimeMs(1100),
      deathClipId: clipId('DefeatKick'),
      deathClipTime: durationMs(time),
      entry: { kind: 'startup', epoch, at: entryAt, sampleSide: 'left' },
    });
    let first: Vector3[] | undefined;
    for (const time of [0, 100, 300, 100, 0]) {
      const input = request(time);
      frame.apply(
        frame.prepare({
          runId: epoch.runId,
          actorId: epoch.actorId,
          revision: 2,
          kind: 'defeat',
          input,
        }),
      );
      required(direct.seekPose).call(
        direct,
        epoch.outgoing.binding,
        durationMs(50),
      );
      required(direct.seekDefeat).call(direct, input);
      expect(rig.node.matrix.toArray([])).toEqual(entryMatrix);
      expect(startupVertices(rig.node)).toEqual(startupVertices(direct.node));
      expect(rig.defeatPoseSupport?.()).toEqual(direct.defeatPoseSupport?.());
      if (time === 100) {
        if (first) expect(startupVertices(rig.node)).toEqual(first);
        else first = startupVertices(rig.node);
      }
      if (time === 0) {
        expect(pose(rig.node)).toEqual(entryPose);
        expect(startupVertices(rig.node)).toEqual(entryVertices);
      }
    }
  } finally {
    rig.dispose();
    direct.dispose();
    pack.dispose();
  }
});
test('startup synthetic canonical startup canonical replay never retains a private layer', async () => {
  const pack = await syntheticStartupPack(),
    rig = pack.create('white');
  try {
    const epoch = await syntheticStartupEpoch(pack),
      driver = required(rig.poseFrame),
      canonical = {
        runId: epoch.runId,
        actorId: epoch.actorId,
        revision: 1,
        kind: 'living' as const,
        epoch: epoch.outgoing,
        at: gameTimeMs(1050),
        side: 'right' as const,
      };
    driver.apply(driver.prepare(canonical));
    const before = startupVertices(rig.node);
    driver.apply(driver.prepare({ ...canonical, epoch, at: gameTimeMs(1050) }));
    expect(rig.node.matrixAutoUpdate).toBe(false);
    driver.apply(driver.prepare(canonical));
    expect(rig.node.matrixAutoUpdate).toBe(true);
    expect(startupVertices(rig.node)).toEqual(before);
    driver.apply(driver.prepare({ ...canonical, epoch, at: epoch.endMs }));
    expect(rig.node.matrix.toArray([])).toEqual(new Matrix4().toArray([]));
  } finally {
    rig.dispose();
    pack.dispose();
  }
});

test('finite composition diagnostic validates nonidentity outer before locals and preserves reset', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = qualified(pack.create('white'));
  try {
    const r = canonicalRequest(pack, 500),
      diag = required(rig.recoveryDiagnostic),
      q = captureCanonicalQuery(r.epoch as any, r.at, 'right'),
      sample = diag.sampleCanonical(q);
    rig.node.position.set(3, 2, 1);
    rig.node.scale.set(2, 1, 1);
    rig.node.updateMatrix();
    const baseline = rig.node.matrix.toArray(),
      before = pose(rig.node);
    const huge = sample.pose.map((n) =>
      n.parent === null ? { ...n, t: [1.5e308, 0, 0] } : n,
    );
    expect(() => diag.apply(huge)).toThrow(
      'Unsupported singular/unrepresentable matrix domain',
    );
    expect(pose(rig.node)).toEqual(before);
    expect(rig.node.matrix.toArray()).toEqual(baseline);
    diag.apply(
      sample.pose,
      new Matrix4().makeRotationY(0.5).toArray([] as number[]),
    );
    expect(rig.node.matrix.toArray().every(Number.isFinite)).toBe(true);
    diag.apply(sample.pose);
    expect(rig.node.matrix.toArray()).toEqual(baseline);
    expect(rig.node.matrixAutoUpdate).toBe(true);
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
test('finite composition visible and transferred stage validate actual outer before token', async () => {
  const pack = await syntheticStartupPack();
  try {
    const epoch = await syntheticStartupEpoch(pack);
    for (const staged of [false, true]) {
      const stage = staged ? required(pack.stageActor)('white') : undefined;
      const rig = stage ? stage.materialize() : pack.create('white');
      try {
        rig.node.position.set(1.5e308, 0, -1.5e308);
        const before = pose(rig.node);
        expect(() =>
          required(rig.poseFrame).prepare({
            kind: 'living',
            runId: epoch.runId,
            actorId: epoch.actorId,
            revision: 1,
            epoch,
            at: gameTimeMs(1050),
            side: 'right',
          }),
        ).toThrow('Unsupported singular/unrepresentable matrix domain');
        expect(pose(rig.node)).toEqual(before);
      } finally {
        rig.dispose();
        stage?.dispose();
      }
    }
  } finally {
    pack.dispose();
  }
});

test('finite composition direct apply captures accessor pose once for validation and writes', async () => {
  const pack = await createThreeAssetPack([source(true)], {}, deaths),
    rig = qualified(pack.create('white'));
  try {
    const r = canonicalRequest(pack, 500),
      diag = required(rig.recoveryDiagnostic),
      sample = diag.sampleCanonical(
        captureCanonicalQuery(r.epoch as any, r.at, 'right'),
      );
    rig.node.scale.set(2, 1, 1);
    let reads = 0;
    const input = sample.pose.map((n) => ({
      ...n,
      q: [0, 0, 0, 1],
      s: [1, 1, 1],
      get t() {
        if (n.parent !== null) return [0, 0, 0];
        reads++;
        return reads <= 2 ? [0, 0, 0] : [1.5e308, 0, 0];
      },
    }));
    diag.apply(input);
    expect(reads).toBe(1);
    rig.node.updateMatrixWorld(true);
    rig.node.traverse((part) =>
      expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true),
    );
  } finally {
    rig.dispose();
    pack.dispose();
  }
});
